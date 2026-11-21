import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check } from 'prettier';
import type { Taxonomy } from '../synth/types.js';
import {
  rebuildBaseline,
  sampleFromSet,
  sampleParamsOfRuns,
} from './baseline.js';
import type { SyntheticSet } from './data.js';
import {
  appendRunLog,
  baselinePaths,
  readRetrieval,
  readRunLog,
  writeRetrieval,
} from './layout.js';
import { buildEvalReviewRows } from './review.js';
import { renderReviewStub } from '../score-eval/review.js';
import {
  fixtureDataset,
  fixtureRecords,
  fixtureRetrieval,
  fixtureRuns,
  loadTaxonomyForSpecs,
} from './test-fixture.js';
import { jobKey } from './score-record.js';

let taxonomy: Taxonomy;
let dir: string;
beforeAll(async () => {
  taxonomy = await loadTaxonomyForSpecs();
});
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'eval-baseline-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A set whose ground truth has the six fixture pairs (all of them sampled). */
function set(): SyntheticSet {
  const ds = fixtureDataset(taxonomy);
  const pairs = [
    ['p1', 90, 'strong'],
    ['p2', 80, 'strong'],
    ['p3', 50, 'partial'],
    ['p4', 40, 'partial'],
    ['p5', 10, 'weak'],
    ['p6', 0, 'weak'],
  ] as const;
  return {
    personas: ds.personas,
    vacancies: [],
    queries: [],
    taxonomy,
    groundTruth: {
      pairs: pairs.map(([personaId, score, band]) => ({
        vacancyId: 'v1',
        personaId,
        score,
        band,
        requirements:
          personaId === 'p1' ? ds.groundTruth.pairs[0].requirements : [],
      })),
    },
    spotCheckLabels: [
      { pair: 1, vacancyId: 'v1', personaId: 'p5', band: 'weak', note: '' },
      { pair: 2, vacancyId: 'v1', personaId: 'p6', band: 'partial', note: '' },
    ],
  };
}

async function writeCache(paths: ReturnType<typeof baselinePaths>) {
  await mkdir(paths.dir, { recursive: true });
  const lines = fixtureRecords().map((r) =>
    JSON.stringify({
      ...r,
      key: jobKey({
        pair: { vacancyId: r.vacancyId, personaId: r.personaId } as never,
        mode: r.mode,
        run: r.run,
      }),
    }),
  );
  await writeFile(paths.scores, lines.join('\n') + '\n');
}

describe('sampleFromSet', () => {
  it('builds the sample from the ground truth and the spot-check labels', () => {
    const s = sampleFromSet(set(), { seed: 1, weak: 0 });
    // weak quota 0, but both weak pairs are spot-check pairs and join
    expect(s.sampled).toEqual({ strong: 2, partial: 2, weak: 2 });
    expect(s.pairs.find((p) => p.personaId === 'p6')?.spotCheck).toBe(
      'partial',
    );
  });
});

describe('sampleParamsOfRuns', () => {
  it('takes the newest scoring invocation, else the fallback', () => {
    const fallback = { seed: 9, weak: 9, noise: 9 };
    expect(sampleParamsOfRuns([], fallback)).toBe(fallback);
    expect(sampleParamsOfRuns([fixtureRuns()[0]], fallback)).toBe(fallback);
    expect(
      sampleParamsOfRuns(
        [{ ...fixtureRuns()[1], seed: 3, weak: 20, noise: 5 }],
        fallback,
      ),
    ).toEqual({ seed: 3, weak: 20, noise: 5 });
  });
});

describe('rebuildBaseline', () => {
  const options = () => ({
    baselineDir: dir,
    label: 'lbl',
    set: set(),
    params: { seed: 1, weak: 150, noise: 50 },
    scored: false,
    now: () => new Date('2026-11-18T12:00:00.000Z'),
  });

  it('writes a prettier-stable json and md from an empty label directory (all not run)', async () => {
    const paths = baselinePaths(dir, 'lbl');
    await mkdir(paths.dir, { recursive: true });
    const result = await rebuildBaseline(options());
    expect(result.aggregate.scoring).toBeNull();
    expect(result.aggregate.retrieval).toBeNull();
    const md = await readFile(paths.aggregateMd, 'utf8');
    expect(md).toMatch(/Scoring: not run\./);
    expect(await check(md, { parser: 'markdown' })).toBe(true);
    const json = await readFile(paths.aggregateJson, 'utf8');
    expect(await check(json, { parser: 'json' })).toBe(true);
  });

  it('combines a retrieval run and a scoring run of the same label', async () => {
    const paths = baselinePaths(dir, 'lbl');
    await writeRetrieval(paths, fixtureRetrieval());
    await appendRunLog(paths, fixtureRuns()[0]);
    const first = await rebuildBaseline(options());
    expect(first.aggregate.retrieval).not.toBeNull();
    expect(first.aggregate.scoring).toBeNull();

    await writeCache(paths);
    await appendRunLog(paths, fixtureRuns()[1]);
    const second = await rebuildBaseline(options());
    expect(second.aggregate.retrieval).not.toBeNull();
    expect(second.aggregate.scoring?.perMode.full_text?.agreement.n).toBe(6);
    expect(second.aggregate.runs).toHaveLength(2);
    expect(second.aggregate.meteredUsd).toBeCloseTo(0.51, 10);

    const md = await readFile(paths.aggregateMd, 'utf8');
    expect(md).toMatch(/## Candidate search/);
    expect(md).not.toMatch(/Retrieval: not run/);
    expect(await check(md, { parser: 'markdown' })).toBe(true);
    // the raw retrieval and the run log round-trip
    expect(await readRetrieval(paths)).toEqual(fixtureRetrieval());
    expect(await readRunLog(paths)).toHaveLength(2);
  });

  it('joins the cache to the sample of the logged run, not of the report invocation', async () => {
    const paths = baselinePaths(dir, 'lbl');
    await writeCache(paths);
    await appendRunLog(paths, { ...fixtureRuns()[1], weak: 0 });
    // report-only with the default weak count: the run log's weak 0 wins
    const result = await rebuildBaseline({
      ...options(),
      params: { seed: 1, weak: 150, noise: 50 },
    });
    expect(result.aggregate.sample.weak).toBe(0);
    expect(result.aggregate.scoring?.unmatchedRecords).toBe(0);
  });

  it('uses the invocation parameters when it scored', async () => {
    const paths = baselinePaths(dir, 'lbl');
    await writeCache(paths);
    await appendRunLog(paths, { ...fixtureRuns()[1], weak: 0 });
    const result = await rebuildBaseline({
      ...options(),
      params: { seed: 2, weak: 5, noise: 1 },
      scored: true,
    });
    expect(result.aggregate.sample).toMatchObject({
      seed: 2,
      weak: 5,
      noise: 1,
    });
  });

  it('picks up a filled-in review, skips a broken one with a warning', async () => {
    const paths = baselinePaths(dir, 'lbl');
    await writeCache(paths);
    const rows = buildEvalReviewRows(fixtureRecords(), 'rag').map((r, i) => ({
      ...r,
      label: i < 2 ? 'supports' : '',
    }));
    await writeFile(paths.review('rag'), renderReviewStub('x', rows));
    await writeFile(paths.review('full_text'), 'not a review table');
    const result = await rebuildBaseline(options());
    expect(result.aggregate.scoring?.reviews).toHaveLength(1);
    expect(result.aggregate.scoring?.reviews[0]).toMatchObject({
      mode: 'rag',
      labelled: 2,
      supports: 2,
      relevanceRate: 1,
    });
    expect(result.warnings.join('\n')).toMatch(/review-full_text\.md skipped/);
  });
});
