import { computeTotals, renderMarkdown } from './report.js';
import type { EvalResult, PairResult } from './result.js';

const usage = (i: number, o: number) => ({
  model: 'gpt-5.4-mini',
  inputTokens: i,
  outputTokens: o,
  totalTokens: i + o,
});

const retrieved = (id: string) => [
  {
    chunkId: id,
    source: 'cv' as const,
    similarity: 0.61234,
    text: 'Built Kafka | pipelines',
  },
];

const pair = (overrides: Partial<PairResult>): PairResult => ({
  vacancyId: 'v1',
  cvId: 'cv1',
  run: 1,
  status: 'scored',
  error: null,
  overall: 70,
  rationale: 'ok',
  criteria: [
    {
      id: 'c1',
      text: 'Kafka',
      importance: 'must',
      score: 70,
      reasoning: 'Used it',
      quotes: [{ source: 'cv', text: 'Built Kafka' }],
      retrieved: retrieved('ch2'),
    },
  ],
  attempts: 1,
  usage: usage(1000, 100),
  costUsd: 0.001,
  expected: 'strong',
  band: 'partial',
  bandResult: 'miss',
  grounded: { ok: true, problems: [] },
  fillerSuspects: [],
  evidenceCoverage: { shown: 1, total: 4, ratio: 0.25 },
  ...overrides,
});

const base: EvalResult = {
  label: 'rag-1',
  model: 'gpt-5.4-mini',
  date: '2026-11-07T10:00:00.000Z',
  runs: 2,
  pricing: { inputPerMillion: 0.75, outputPerMillion: 4.5 },
  mode: 'rag',
  k: 3,
  embeddingModel: 'text-embedding-3-small',
  embeddingPrice: 0.02,
  cvs: [
    {
      id: 'cv1',
      file: 'a.pdf',
      githubUrl: null,
      githubStatus: 'none',
      textLength: 100,
      error: null,
      chunkCount: 4,
      embeddingTokens: 400,
      embeddingCostUsd: 0.000008,
    },
  ],
  vacancies: [{ id: 'v1', title: 'Backend', requirementCount: 2 }],
  extractions: [1, 2].map((run) => ({
    vacancyId: 'v1',
    run,
    error: null,
    criteria: [{ id: 'c1', text: 'Kafka', importance: 'must' as const }],
    usage: usage(100, 10),
    costUsd: 0.0001,
    coverage: null,
    embeddingTokens: 50,
    embeddingCostUsd: 0.000001,
  })),
  pairs: [
    pair({ run: 1 }),
    pair({ run: 2, evidenceCoverage: { shown: 3, total: 4, ratio: 0.75 } }),
  ],
};

describe('computeTotals in rag mode', () => {
  it('adds embedding tokens and cost to the total and summarises coverage', () => {
    const t = computeTotals(base);
    expect(t.embeddingTokens).toBe(500);
    expect(t.embeddingCost).toBeCloseTo(0.00001);
    expect(t.totalCost).toBeCloseTo(
      t.extractionCost + t.scoringCost + t.embeddingCost,
    );
    expect(t.evidenceCoverage).toEqual({
      pairs: 2,
      mean: 0.5,
      min: 0.25,
      max: 0.75,
    });
  });
});

describe('renderMarkdown in rag mode', () => {
  const md = renderMarkdown(base);

  it('records the mode, k and embedding model', () => {
    expect(md).toContain(
      '- Mode: RAG, 3 chunk(s) per criterion, embeddings text-embedding-3-small at $0.02 per 1M tokens',
    );
    expect(md).toContain('- Embeddings: 500 tokens, $0.0000');
    expect(md).toContain('mean 50%, min 25%, max 75% over 2 pairs');
  });

  it('has a results table with mode, embedding tokens and coverage per run', () => {
    expect(md).toContain(
      '| Run | Mode | Pairs | Scored | Embedding tokens | Evidence coverage (mean / min / max) | Cost |',
    );
    expect(md).toContain('| CV chunks (once) | RAG | — | — | 400 | — |');
    expect(md).toContain('| 1 | RAG | 1 | 1 | 50 | 25% / 25% / 25% |');
    expect(md).toContain('| 2 | RAG | 1 | 1 | 50 | 75% / 75% / 75% |');
    expect(md).toContain('| Total | RAG | 2 | 2 | 500 | 50% / 25% / 75% |');
  });

  it('shows coverage and retrieved chunk previews in the pair breakdown', () => {
    expect(md).toContain(
      'Evidence coverage: 1/4 chunks shown to the model (25%).',
    );
    expect(md).toContain(
      '| Criterion | Importance | Score | Reasoning | Quotes | Retrieved |',
    );
    expect(md).toContain('ch2 [cv] 0.61 "Built Kafka \\| pipelines"');
    expect(md).toContain('Criteria embedding: 50 tokens');
  });
});

describe('renderMarkdown in full text mode', () => {
  const full: EvalResult = {
    ...base,
    mode: 'full_text',
    k: undefined,
    embeddingModel: undefined,
    embeddingPrice: undefined,
    cvs: base.cvs.map(
      ({ id, file, githubUrl, githubStatus, textLength, error }) => ({
        id,
        file,
        githubUrl,
        githubStatus,
        textLength,
        error,
      }),
    ),
    extractions: base.extractions.map((e) => ({
      vacancyId: e.vacancyId,
      run: e.run,
      error: e.error,
      criteria: e.criteria,
      usage: e.usage,
      costUsd: e.costUsd,
      coverage: e.coverage,
    })),
    pairs: base.pairs.map((p) => ({
      ...p,
      evidenceCoverage: undefined,
      criteria: p.criteria.map((c) => ({ ...c, retrieved: undefined })),
    })),
  };
  const md = renderMarkdown(full);

  it('shows a dash for the rag-only columns and no rag lines', () => {
    expect(md).toContain('| 1 | Full text | 1 | 1 | — | — |');
    expect(md).toContain('| Total | Full text | 2 | 2 | — | — |');
    expect(md).not.toContain('CV chunks (once)');
    expect(md).not.toContain('- Mode: RAG');
    expect(md).not.toContain('- Embeddings:');
    expect(md).not.toContain('Evidence coverage:');
    expect(md).not.toContain('Retrieved |');
  });

  it('costs only chat tokens', () => {
    const t = computeTotals(full);
    expect(t.embeddingTokens).toBe(0);
    expect(t.totalCost).toBeCloseTo(t.extractionCost + t.scoringCost);
    expect(t.evidenceCoverage).toBeNull();
  });
});
