/**
 * Hand-built data for the report specs: a six-pair sample, scores in both
 * modes with every kind of outcome, and a small retrieval result. The numbers
 * the specs assert are worked out next to each record.
 */
import { loadDraftData } from '../synth/test-data.js';
import type { Band, PersonaSpec, Taxonomy } from '../synth/types.js';
import type { G4Dataset } from './g4-pair.js';
import type { RunLogEntry } from './layout.js';
import type { RetrievalResult } from './retrieval.js';
import type { EvalSample, SampledPair } from './sample.js';
import type {
  RecordedCriterion,
  ScoreFailedRecord,
  ScoreJobRecord,
  ScoreOkRecord,
  ScoringMode,
} from './score-record.js';

export async function loadTaxonomyForSpecs(): Promise<Taxonomy> {
  return (await loadDraftData()).taxonomy;
}

const persona = (
  id: string,
  extra: Partial<PersonaSpec> = {},
  skills: Array<[string, PersonaSpec['skills'][number]['evidence']]> = [],
): PersonaSpec => ({
  id,
  name: id,
  email: `${id}@example.com`,
  language: 'en',
  layout: '1-col',
  roles: [],
  projects: [],
  skills: skills.map(([tag, evidence]) => ({ tag, years: 0, evidence })),
  github: null,
  kind: 'targeted',
  flags: [],
  applyTo: [],
  ...extra,
});

/** p1 is Ukrainian with two github-only skills, p2 a keyword stuffer, p3 an injection persona. */
export const fixturePersonas = (): PersonaSpec[] => [
  persona('p1', { language: 'uk' }, [
    ['rust', 'github_only'],
    ['kubernetes', 'github_only'],
  ]),
  persona('p2', { flags: ['keyword_stuffer'] }),
  persona('p3', { flags: ['injection'] }),
  persona('p4'),
  persona('p5'),
  persona('p6'),
];

const pair = (
  personaId: string,
  score: number,
  band: Band,
  weight: number,
  spotCheck: Band | null = null,
): SampledPair => ({
  vacancyId: 'v1',
  personaId,
  score,
  band,
  weight,
  spotCheck,
});

/** Population 2 strong, 2 partial, 10 weak; the weak band is sampled 2 of 10 (weight 5). */
export const fixtureSample = (): EvalSample => ({
  seed: 1,
  population: { strong: 2, partial: 2, weak: 10 },
  sampled: { strong: 2, partial: 2, weak: 2 },
  pairs: [
    pair('p1', 90, 'strong', 1),
    pair('p2', 80, 'strong', 1),
    pair('p3', 50, 'partial', 1),
    pair('p4', 40, 'partial', 1),
    pair('p5', 10, 'weak', 5, 'weak'),
    pair('p6', 0, 'weak', 5, 'partial'),
  ],
});

export const fixtureDataset = (taxonomy: Taxonomy): G4Dataset => ({
  taxonomy,
  personas: fixturePersonas(),
  groundTruth: {
    pairs: [
      {
        vacancyId: 'v1',
        personaId: 'p1',
        score: 90,
        band: 'strong',
        requirements: [
          { requirementId: 'r1', status: 'met', tag: 'rust' },
          { requirementId: 'r2', status: 'met', tag: 'kubernetes' },
        ],
      },
    ],
  },
});

const criterion = (
  id: string,
  text: string,
  score: number,
  quotes: RecordedCriterion['quotes'] = [],
): RecordedCriterion => ({
  id,
  text,
  importance: 'must',
  score,
  reasoning: '',
  quotes,
});

interface OkOptions {
  attempts?: 1 | 2;
  run?: 1 | 2;
  criteria?: RecordedCriterion[];
}

const TOKENS: Record<ScoringMode, [number, number, number]> = {
  full_text: [2000, 400, 0.01],
  rag: [1000, 200, 0.005],
};

export function ok(
  mode: ScoringMode,
  personaId: string,
  overall: number,
  options: OkOptions = {},
): ScoreOkRecord {
  const run = options.run ?? 1;
  const [inputTokens, outputTokens, costUsd] = TOKENS[mode];
  return {
    key: `v1|${personaId}|${mode}|${run}`,
    vacancyId: 'v1',
    personaId,
    mode,
    run,
    at: '2026-11-18T10:00:00.000Z',
    status: 'ok',
    overall,
    criteria: options.criteria ?? [
      criterion('c1', 'Good communication', overall, [
        { source: 'cv', text: `quote for ${personaId}` },
      ]),
    ],
    attempts: options.attempts ?? 1,
    inputTokens,
    outputTokens,
    costUsd,
  };
}

export function failed(
  mode: ScoringMode,
  personaId: string,
  kind: 'grounding' | 'api' | 'parse',
  run: 1 | 2 = 1,
): ScoreFailedRecord {
  return {
    key: `v1|${personaId}|${mode}|${run}`,
    vacancyId: 'v1',
    personaId,
    mode,
    run,
    at: '2026-11-18T10:00:00.000Z',
    status: 'failed',
    failure: {
      kind,
      message: `${kind} failure`,
      ...(kind === 'grounding' && {
        problems: [
          'Criterion c1: quote "made up" is not a verbatim excerpt of <cv>',
        ],
      }),
    },
  };
}

/**
 * full_text run 1 overall: 85, 60, 55, 20, 10, 30 (p1..p6) against the rule
 * 90, 80, 50, 40, 10, 0. rag run 1: 95, 82, 45, 41, failed (grounding), 5.
 * Run 2: full_text p1 80 and p4 30; rag p1 97 and p5 failed (api).
 */
export function fixtureRecords(): ScoreJobRecord[] {
  const rustCriterion = (score: number, github: boolean) => [
    criterion(
      'c1',
      'Production experience with Rust',
      score,
      github ? [{ source: 'github', text: 'Rust service' }] : [],
    ),
  ];
  return [
    ok('full_text', 'p1', 85, {
      attempts: 2,
      criteria: rustCriterion(0, false),
    }),
    ok('full_text', 'p2', 60),
    ok('full_text', 'p3', 55),
    ok('full_text', 'p4', 20),
    ok('full_text', 'p5', 10),
    ok('full_text', 'p6', 30),
    ok('full_text', 'p1', 80, { run: 2, criteria: rustCriterion(0, false) }),
    ok('full_text', 'p4', 30, { run: 2 }),
    ok('rag', 'p1', 95, { criteria: rustCriterion(70, true) }),
    ok('rag', 'p2', 82),
    ok('rag', 'p3', 45),
    ok('rag', 'p4', 41, { attempts: 2 }),
    failed('rag', 'p5', 'grounding'),
    ok('rag', 'p6', 5),
    ok('rag', 'p1', 97, { run: 2, criteria: rustCriterion(70, true) }),
    failed('rag', 'p5', 'api', 2),
  ];
}

export const fixtureRuns = (): RunLogEntry[] => [
  {
    part: 'retrieval',
    startedAt: '2026-11-18T09:00:00.000Z',
    finishedAt: '2026-11-18T09:01:00.000Z',
    modes: [],
    seed: 1,
    weak: 150,
    noise: 50,
    limit: null,
    concurrency: 4,
    maxUsd: 6,
    retryFailed: false,
    spentUsd: 0.01,
    stopped: null,
    scoring: null,
  },
  {
    part: 'scoring',
    startedAt: '2026-11-18T10:00:00.000Z',
    finishedAt: '2026-11-18T11:00:00.000Z',
    modes: ['full_text', 'rag'],
    seed: 1,
    weak: 150,
    noise: 50,
    limit: null,
    concurrency: 4,
    maxUsd: 6,
    retryFailed: false,
    spentUsd: 0.5,
    stopped: null,
    scoring: { planned: 16, done: 14, failed: 2, skipped: 0, notStarted: 0 },
  },
];

const metrics = (v: number) => ({
  p5: v,
  p10: v,
  r10: v,
  r20: v,
  ndcg10: v,
});

export function fixtureRetrieval(): RetrievalResult {
  const vacancy = (mode: string) => ({
    vacancyId: 'v1',
    title: `Backend | Engineer (${mode})`,
    returned: 12,
    ranked: ['p1', 'p2'],
    bands: { strong: 2, partial: 2, weak: 10 },
    metrics: metrics(0.5),
    weakInTop10: 3,
    weakShareTop10: 0.3,
  });
  const g5 = (mode: 'criteria' | 'whole_text') => ({
    mode,
    meanWeakShare: 0.3,
    pooledWeakShare: 0.25,
    worst: [
      {
        personaId: 'p6',
        rank: 2,
        vacancyId: 'v1',
        title: 'Backend Engineer',
        score: 0.4,
        matchedCriteria:
          mode === 'criteria'
            ? [{ criterionId: 'c1', criterion: 'Rust | Go', similarity: 0.51 }]
            : [],
        snippet: 'line one\nline two | with a pipe',
      },
    ],
  });
  const sweepRow = (floor: number) => ({
    floor,
    returned: 10,
    metrics: { ...metrics(0.4), rr: 0.5 },
    queries: [],
  });
  return {
    settings: {
      search: {
        chunkLimit: 50,
        floor: 0.3,
        maxResults: 20,
        maxSnippets: 3,
        sweepFloors: [0.2, 0.25, 0.3, 0.35],
      },
      matches: {
        criteriaFloor: 0.4,
        wholeTextFloor: 0.3,
        perCriterionChunkLimit: 20,
        wholeTextChunkLimit: 50,
        maxSnippets: 3,
        maxCandidates: 100,
        excludesApplicants: false,
      },
    },
    search: {
      productionFloor: 0.3,
      metrics: { ...metrics(0.6), rr: 0.7 },
      returned: 12,
      queries: [
        {
          queryId: 'q1',
          query: 'rust developer',
          relevant: 3,
          partiallyRelevant: 1,
          returned: 12,
          ranked: ['p1'],
          unmapped: 0,
          metrics: { ...metrics(0.6), rr: 1 },
        },
      ],
      sweep: [0.2, 0.25, 0.3, 0.35].map(sweepRow),
    },
    matches: {
      criteria: {
        mode: 'criteria',
        vacancies: [vacancy('criteria')],
        metrics: metrics(0.5),
        returned: 12,
      },
      whole_text: {
        mode: 'whole_text',
        vacancies: [vacancy('whole_text')],
        metrics: metrics(0.45),
        returned: 30,
      },
    },
    g5: { criteria: g5('criteria'), whole_text: g5('whole_text') },
  };
}
