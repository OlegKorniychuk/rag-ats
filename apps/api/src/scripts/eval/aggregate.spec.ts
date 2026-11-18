import type { Taxonomy } from '../synth/types.js';
import { buildAggregate, type AggregateInput } from './aggregate.js';
import {
  failed,
  fixtureDataset,
  fixtureRecords,
  fixtureRetrieval,
  fixtureRuns,
  fixtureSample,
  loadTaxonomyForSpecs,
  ok,
} from './test-fixture.js';

let taxonomy: Taxonomy;
beforeAll(async () => {
  taxonomy = await loadTaxonomyForSpecs();
});

const input = (over: Partial<AggregateInput> = {}): AggregateInput => ({
  label: 'fx',
  generatedAt: '2026-11-18T12:00:00.000Z',
  sample: fixtureSample(),
  sampleParams: { weak: 150, noise: 50 },
  dataset: fixtureDataset(taxonomy),
  records: fixtureRecords(),
  retrieval: null,
  runs: fixtureRuns(),
  ...over,
});

const scoring = (over: Partial<AggregateInput> = {}) => {
  const s = buildAggregate(input(over)).scoring;
  if (!s) throw new Error('no scoring');
  return s;
};
const full = () => scoring().perMode.full_text!;
const rag = () => scoring().perMode.rag!;

describe('buildAggregate agreement', () => {
  it('computes MAE, signed error, per-band MAE and band agreement from run 1', () => {
    const a = full().agreement;
    expect(a.n).toBe(6);
    expect(a.mae.estimate).toBeCloseTo(80 / 6, 10);
    expect(a.meanSignedError).toBeCloseTo(-10 / 6, 10);
    expect(a.perBandMae).toEqual({ strong: 12.5, partial: 12.5, weak: 15 });
    expect(a.perBandN).toEqual({ strong: 2, partial: 2, weak: 2 });
    expect(a.bandAgreement).toBeCloseTo(4 / 6, 10);
  });

  it('weights the population view by the sampling weights', () => {
    const a = full().agreement;
    expect(a.weightedMae).toBeCloseTo(200 / 14, 10);
    expect(a.weightedBandAgreement).toBeCloseTo(12 / 14, 10);
  });

  it('gives bootstrap intervals that are deterministic and bracket-ordered', () => {
    const a = full().agreement;
    expect(a.mae.resamples).toBe(1000);
    expect(a.mae.lo!).toBeLessThanOrEqual(a.mae.hi!);
    expect(a.spearman.estimate).not.toBeNull();
    expect(a.kappa.estimate).not.toBeNull();
    expect(scoring().perMode.full_text!.agreement.mae).toEqual(a.mae);
  });

  it('leaves out failed jobs and counts them in the coverage', () => {
    expect(rag().agreement.n).toBe(5);
    expect(rag().agreement.mae.estimate).toBeCloseTo(18 / 5, 10);
    expect(rag().coverage).toEqual({
      sampled: 6,
      ok: 5,
      failed: 1,
      failedByKind: { grounding: 1, api: 0, parse: 0 },
      missing: 0,
    });
  });

  it('uses run 1 only for the agreement (run 2 does not leak in)', () => {
    const records = [...fixtureRecords(), ok('full_text', 'p2', 0, { run: 2 })];
    expect(
      scoring({ records }).perMode.full_text!.agreement.mae.estimate,
    ).toBeCloseTo(80 / 6, 10);
  });
});

describe('buildAggregate against Dude', () => {
  it('compares scorer bands and rule bands with the spot-check labels', () => {
    const d = full().vsDude!;
    expect(d.pairs).toBe(2);
    // p5: Dude weak, scorer weak. p6: Dude partial, scorer 30 = weak.
    expect(d.scorer.exactAgreement).toBe(0.5);
    // p5: Dude weak, rule weak. p6: Dude partial, rule weak.
    expect(d.rule.exactAgreement).toBe(0.5);
    expect(d.ruleAll.pairs).toBe(2);
  });

  it('only counts spot-check pairs the mode scored', () => {
    expect(rag().vsDude!.pairs).toBe(1); // p5 failed in rag
  });

  it('is null when no spot-check pair was scored', () => {
    const records = fixtureRecords().filter(
      (r) => r.personaId !== 'p5' && r.personaId !== 'p6',
    );
    expect(scoring({ records }).perMode.full_text!.vsDude).toBeNull();
  });
});

describe('buildAggregate paired difference', () => {
  it('takes full_text minus rag over the pairs ok in both modes', () => {
    const p = scoring().paired!;
    expect(p.pairs).toBe(5); // p5 failed in rag
    // full_text MAE over those five: 80/5 - 0; rag: 3.6
    expect(p.mae.estimate).toBeCloseTo(16 - 3.6, 10);
    expect(p.mae.lo!).toBeLessThanOrEqual(p.mae.hi!);
  });

  it('is null when one mode has no records', () => {
    const records = fixtureRecords().filter((r) => r.mode === 'full_text');
    const s = scoring({ records });
    expect(s.paired).toBeNull();
    expect(s.perMode.rag).toBeNull();
  });
});

describe('buildAggregate noise', () => {
  it('measures run 2 against run 1 on pairs ok in both runs', () => {
    expect(full().noise).toEqual({
      pairs: 2,
      meanAbsDelta: 7.5,
      spearman: 1,
      maxAbsDelta: 10,
      meanSignedDelta: 2.5,
    });
  });

  it('skips a pair whose run 2 failed; a single pair has no rho', () => {
    expect(rag().noise).toEqual({
      pairs: 1,
      meanAbsDelta: 2,
      spearman: null,
      maxAbsDelta: 2,
      meanSignedDelta: 2,
    });
  });

  it('is empty without run 2 records', () => {
    const records = fixtureRecords().filter((r) => r.run === 1);
    expect(scoring({ records }).perMode.full_text!.noise).toEqual({
      pairs: 0,
      meanAbsDelta: null,
      spearman: null,
      maxAbsDelta: null,
      meanSignedDelta: null,
    });
  });
});

describe('buildAggregate grounding', () => {
  it('counts attempts 2 as a first-pass failure and no after-retry failure', () => {
    const g = full().grounding;
    expect(g).toMatchObject({
      jobs: 8,
      ok: 8,
      okAfterRetry: 1,
      groundingFailures: 0,
      firstPassFailureRate: 1 / 8,
      afterRetryFailureRate: 0,
    });
  });

  it('adds grounding failures to both rates and leaves api failures out', () => {
    const g = rag().grounding;
    expect(g).toMatchObject({
      jobs: 8,
      ok: 6,
      okAfterRetry: 1,
      groundingFailures: 1,
      apiFailures: 1,
      parseFailures: 0,
    });
    // (1 + 1) / (6 + 1) and 1 / (6 + 1): the api failure is in neither.
    expect(g.firstPassFailureRate).toBeCloseTo(2 / 7, 10);
    expect(g.afterRetryFailureRate).toBeCloseTo(1 / 7, 10);
    expect(g.buckets['quote-not-found-cv']).toBe(1);
  });

  it('has no rates when nothing was graded', () => {
    const records = [failed('rag', 'p1', 'api'), failed('rag', 'p2', 'parse')];
    const g = scoring({ records }).perMode.rag!.grounding;
    expect(g.firstPassFailureRate).toBeNull();
    expect(g.afterRetryFailureRate).toBeNull();
    expect(g).toMatchObject({ apiFailures: 1, parseFailures: 1 });
  });
});

describe('buildAggregate cost', () => {
  it('averages tokens and chat USD per ok score, and sums the metered spend', () => {
    expect(full().cost).toMatchObject({
      okScores: 8,
      meanInputTokens: 2000,
      meanOutputTokens: 400,
      meanCostUsd: 0.01,
    });
    expect(full().cost.totalCostUsd).toBeCloseTo(0.08, 10);
    expect(rag().cost.okScores).toBe(6);
    const report = buildAggregate(input());
    expect(report.meteredUsd).toBeCloseTo(0.51, 10);
    expect(report.pricingCaveat).toMatch(/third-party/);
  });
});

describe('buildAggregate G4', () => {
  it('counts github-only tags, the unmapped ones apart, and the shares over mapped', () => {
    expect(full().g4).toEqual({
      tags: 2,
      mapped: 1,
      unmapped: 1,
      credited: 0,
      citedGithub: 0,
      creditedShare: 0,
      citedGithubShare: 0,
    });
    expect(rag().g4).toMatchObject({
      tags: 2,
      mapped: 1,
      unmapped: 1,
      credited: 1,
      citedGithub: 1,
      creditedShare: 1,
      citedGithubShare: 1,
    });
  });

  it('has no shares when no tag is mapped', () => {
    const records = [ok('full_text', 'p1', 50)];
    const g4 = scoring({ records }).perMode.full_text!.g4;
    expect(g4).toMatchObject({ tags: 2, mapped: 0, unmapped: 2 });
    expect(g4.creditedShare).toBeNull();
  });
});

describe('buildAggregate slices', () => {
  it('reports MAE and n for uk, stuffers, injection and the rest', () => {
    const s = full().slices;
    expect(s.uk).toEqual({ n: 1, mae: 5, meanSignedError: -5 });
    expect(s.keywordStuffers).toEqual({ n: 1, mae: 20, meanSignedError: -20 });
    expect(s.injection).toEqual({ n: 1, mae: 5, meanSignedError: 5 });
    expect(s.rest.n).toBe(3);
    expect(s.rest.mae).toBeCloseTo(50 / 3, 10);
    expect(s.rest.meanSignedError).toBeCloseTo(10 / 3, 10);
  });

  it('puts a persona in every slice it belongs to, and out of the rest', () => {
    const dataset = fixtureDataset(taxonomy);
    dataset.personas = dataset.personas.map((p) =>
      p.id === 'p4' ? { ...p, language: 'uk', flags: ['injection'] } : p,
    );
    const s = scoring({ dataset }).perMode.full_text!.slices;
    expect(s.uk.n).toBe(2);
    expect(s.injection.n).toBe(2);
    expect(s.rest.n).toBe(2);
  });
});

describe('buildAggregate missing parts', () => {
  it('has no scoring section without records, and keeps the retrieval as given', () => {
    const retrieval = fixtureRetrieval();
    const report = buildAggregate(input({ records: [], retrieval }));
    expect(report.scoring).toBeNull();
    expect(report.retrieval).toBe(retrieval);
  });

  it('has no retrieval section when it was not run', () => {
    expect(buildAggregate(input()).retrieval).toBeNull();
  });

  it('ignores records outside the sample and counts them', () => {
    const stray = { ...ok('full_text', 'p1', 50), personaId: 'p99' };
    const s = scoring({ records: [...fixtureRecords(), stray] });
    expect(s.unmatchedRecords).toBe(1);
    expect(s.perMode.full_text!.agreement.n).toBe(6);
  });

  it('records the sample design', () => {
    expect(buildAggregate(input()).sample).toEqual({
      seed: 1,
      weak: 150,
      noise: 50,
      population: { strong: 2, partial: 2, weak: 10 },
      sampled: { strong: 2, partial: 2, weak: 2 },
      pairs: 6,
      spotCheckPairs: 2,
    });
  });

  it('lists a row per sampled pair with both modes and both runs', () => {
    const rows = scoring().pairs;
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({
      personaId: 'p1',
      rule: 90,
      scores: {
        full_text: { run1: 85, run2: 80, failure: null },
        rag: { run1: 95, run2: 97, failure: null },
      },
    });
    expect(rows[4].scores.rag).toEqual({
      run1: null,
      run2: null,
      failure: 'grounding',
    });
  });
});
