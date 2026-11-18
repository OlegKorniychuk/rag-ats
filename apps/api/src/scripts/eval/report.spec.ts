import { check, format } from 'prettier';
import type { Taxonomy } from '../synth/types.js';
import { buildAggregate, type BaselineAggregate } from './aggregate.js';
import { ciText, renderReport, renderReportRaw } from './report.js';
import { reviewAggregateOf } from './review.js';
import {
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

const aggregate = (
  over: Partial<Parameters<typeof buildAggregate>[0]> = {},
): BaselineAggregate =>
  buildAggregate({
    label: 'fx',
    generatedAt: '2026-11-18T12:00:00.000Z',
    sample: fixtureSample(),
    sampleParams: { weak: 150, noise: 50 },
    dataset: fixtureDataset(taxonomy),
    records: fixtureRecords(),
    retrieval: fixtureRetrieval(),
    runs: fixtureRuns(),
    reviews: [
      reviewAggregateOf('rag', [
        {
          row: 'v1/p1/c1/q1',
          pair: 'v1 x p1',
          criterion: 'Rust (must)',
          score: 70,
          source: 'github',
          quote: 'Rust service',
          label: 'supports',
          note: '',
        },
      ]),
    ],
    ...over,
  });

describe('ciText', () => {
  it('writes the estimate and the interval to 3 decimals', () => {
    expect(
      ciText({ estimate: 0.5, lo: 0.4012, hi: 0.61, resamples: 10, valid: 10 }),
    ).toBe('0.500 [0.401, 0.610]');
  });

  it('degrades to the estimate, or n/a', () => {
    expect(
      ciText({ estimate: 0.5, lo: null, hi: null, resamples: 0, valid: 0 }),
    ).toBe('0.500');
    expect(
      ciText({ estimate: null, lo: null, hi: null, resamples: 0, valid: 0 }),
    ).toBe('n/a');
  });
});

describe('renderReport', () => {
  it('starts with the headline and has the sample design note', () => {
    const md = renderReportRaw(aggregate());
    const headings = md.match(/^#{1,3} .*$/gm) ?? [];
    expect(headings[0]).toBe('# Eval baseline: fx');
    expect(headings[1]).toBe('## Headline');
    expect(headings).toContain('## Sample design');
    expect(md).toMatch(/Weighted MAE and weighted band agreement/);
    expect(md).toMatch(/Spearman rho.*over the sample only/);
    expect(md).toMatch(/no applicant exclusion/);
    expect(md).toMatch(/no cap of 10/);
  });

  it('puts the headline numbers in a table with CIs as [lo, hi]', () => {
    const md = renderReportRaw(aggregate());
    const headline = md.slice(
      md.indexOf('## Headline'),
      md.indexOf('## Sample design'),
    );
    expect(headline).toMatch(/\| full_text \| 6 \| .*\[.*, .*\]/);
    expect(headline).toMatch(/\| rag \| 5 \|/);
    expect(headline).toMatch(
      /G5, weak-band share of the top 10: criteria 0\.250/,
    );
    expect(headline).toMatch(
      /Citation relevance.*rag 1\.000 \(1\/1 labelled\)/,
    );
    // three decimals, never more
    expect(headline).not.toMatch(/\d\.\d{4,}/);
  });

  it('reports the grounding rates and api exclusion', () => {
    const md = renderReportRaw(aggregate());
    const section = md.slice(md.indexOf('## Grounding'), md.indexOf('## Cost'));
    expect(section).toMatch(/API \(excluded\)/);
    expect(section).toMatch(/0\.286/); // rag first pass 2/7
    expect(section).toMatch(/quote-not-found-cv/);
  });

  it('says "not run" for a missing retrieval part', () => {
    const md = renderReportRaw(aggregate({ retrieval: null }));
    expect(md).toMatch(/Retrieval: not run\./);
    expect(md).toMatch(/## Candidate search\n\nnot run\./);
    expect(md).toMatch(/## Find matches\n\nnot run\./);
    expect(md).toMatch(/## Score agreement with the rule/);
  });

  it('says "not run" for missing scoring, and for a mode that was not scored', () => {
    const none = renderReportRaw(aggregate({ records: [], runs: [] }));
    expect(none).toMatch(/Scoring: not run\./);
    expect(none).toMatch(/## Run-to-run noise\n\n.*not run\./s);
    expect(none).toMatch(
      /## full_text vs rag\n\nnot run \(needs both modes\)\./,
    );
    expect(none).toMatch(/## Run log\n\nnot run\./);

    const ragOnly = renderReportRaw(
      aggregate({ records: fixtureRecords().filter((r) => r.mode === 'rag') }),
    );
    expect(ragOnly).toMatch(/Scoring `full_text`: not run\./);
    expect(ragOnly).not.toMatch(/\| full_text \| 6 \|/);
  });

  it('does not break a table on a pipe or a newline in a cell', () => {
    const md = renderReportRaw(aggregate());
    expect(md).toContain('Backend \\| Engineer (criteria)');
    expect(md).toContain('line one line two \\| with a pipe');
  });

  it('notes cached scores that are outside the sample', () => {
    const stray = { ...ok('full_text', 'p1', 50), personaId: 'p99' };
    const md = renderReportRaw(
      aggregate({ records: [...fixtureRecords(), stray] }),
    );
    expect(md).toMatch(/Note: 1 cached score\(s\) belong to pairs outside/);
  });

  it('is prettier-stable as written', async () => {
    for (const report of [
      aggregate(),
      aggregate({ retrieval: null }),
      aggregate({ records: [], runs: [] }),
    ]) {
      const out = await renderReport(report);
      expect(await check(out, { parser: 'markdown' })).toBe(true);
      expect(await format(out, { parser: 'markdown' })).toBe(out);
    }
  });
});
