import { computeTotals, renderMarkdown } from './report.js';
import type { EvalResult, PairResult } from './result.js';

const usage = (i: number, o: number) => ({
  model: 'gpt-5.4-mini',
  inputTokens: i,
  outputTokens: o,
  totalTokens: i + o,
});

const pair = (overrides: Partial<PairResult>): PairResult => ({
  vacancyId: 'v1',
  cvId: 'cv1',
  run: 1,
  status: 'scored',
  error: null,
  overall: 82,
  rationale: 'Strong fit | overall',
  criteria: [
    {
      id: 'c1',
      text: 'Kafka',
      importance: 'must',
      score: 82,
      reasoning: 'Used it',
      quotes: [{ source: 'cv', text: 'Built Kafka | pipelines' }],
    },
    {
      id: 'c2',
      text: 'Go',
      importance: 'nice',
      score: 0,
      reasoning: 'None',
      quotes: [{ source: 'cv', text: 'Built Kafka | pipelines' }],
    },
  ],
  attempts: 1,
  usage: usage(2000, 300),
  costUsd: 0.003,
  expected: 'strong',
  band: 'strong',
  bandResult: 'match',
  grounded: { ok: true, problems: [] },
  fillerSuspects: [],
  ...overrides,
});

const result: EvalResult = {
  label: 'baseline',
  model: 'gpt-5.4-mini',
  date: '2026-10-31T10:00:00.000Z',
  runs: 2,
  pricing: { inputPerMillion: 0.75, outputPerMillion: 4.5 },
  cvs: [
    {
      id: 'cv1',
      file: 'a.pdf',
      githubUrl: null,
      githubStatus: 'none',
      textLength: 100,
      error: null,
    },
    {
      id: 'cv2',
      file: 'b.pdf',
      githubUrl: null,
      githubStatus: 'none',
      textLength: 100,
      error: null,
    },
  ],
  vacancies: [
    { id: 'v1', title: 'Backend', requirementCount: 6 },
    { id: 'v2', title: 'Data', requirementCount: 14 },
  ],
  extractions: [
    {
      vacancyId: 'v2',
      run: 1,
      error: null,
      criteria: [
        { id: 'c1', text: 'PyTorch deep learning', importance: 'must' },
      ],
      usage: usage(500, 100),
      costUsd: 0.001,
      coverage: { covered: ['PyTorch'], missing: ['dbt', 'Spark'] },
    },
    {
      vacancyId: 'v1',
      run: 1,
      error: null,
      criteria: [{ id: 'c1', text: 'Kafka', importance: 'must' }],
      usage: usage(400, 80),
      costUsd: 0.0005,
      coverage: null,
    },
  ],
  pairs: [
    pair({ run: 1, overall: 82 }),
    pair({ run: 2, overall: 79, attempts: 2 }),
    pair({
      cvId: 'cv2',
      run: 1,
      overall: 60,
      band: 'partial',
      bandResult: 'miss',
      grounded: { ok: false, problems: ['c1 q1: bad quote'] },
      fillerSuspects: [
        {
          criterionId: 'c2',
          quote: 'Built Kafka | pipelines',
          sharedWith: ['c1'],
        },
      ],
    }),
    pair({
      cvId: 'cv2',
      run: 2,
      status: 'failed',
      error: 'LlmGroundingError: Could not ground the score in the CV',
      overall: null,
      band: null,
      bandResult: 'miss',
      grounded: null,
      criteria: [],
      attempts: 2,
    }),
    pair({
      vacancyId: 'v2',
      expected: null,
      bandResult: 'none',
      overall: 20,
      band: 'weak',
    }),
  ],
};

describe('computeTotals', () => {
  it('aggregates pairs, bands, retries, spread and cost', () => {
    const t = computeTotals(result);
    expect(t).toMatchObject({
      pairs: 5,
      scored: 4,
      failed: 1,
      grounded: 3,
      retried: 2,
      bandExpected: 4,
      bandMatches: 2,
      spreadPairs: 1,
      meanSpread: 3,
      maxSpread: 3,
      extractionInput: 900,
      extractionOutput: 180,
      scoringInput: 10000,
      scoringOutput: 1500,
    });
    expect(t.extractionCost).toBeCloseTo(0.0015);
    expect(t.scoringCost).toBeCloseTo(0.015);
  });

  it('reports no spread for single-run results', () => {
    const t = computeTotals({ ...result, pairs: [pair({})] });
    expect(t.meanSpread).toBeNull();
    expect(t.maxSpread).toBeNull();
  });
});

describe('renderMarkdown', () => {
  const md = renderMarkdown(result);

  it('has the header with model, runs, prices and caveat', () => {
    expect(md).toContain('# Score eval: baseline');
    expect(md).toContain('- Model: gpt-5.4-mini');
    expect(md).toContain('- Runs: 2');
    expect(md).toContain('$0.75 / $4.5 per 1M input / output tokens');
    expect(md).toContain('unverified against OpenAI');
  });

  it('has the totals', () => {
    expect(md).toContain('- Pairs: 5 (4 scored, 1 failed)');
    expect(md).toContain('- Grounded: 3/4 scored pairs (75.0%)');
    expect(md).toContain('- Failed: 1/5 (20.0%)');
    expect(md).toContain('- Retried (more than one attempt): 2/5 (40.0%)');
    expect(md).toContain(
      '- Band agreement: 2/4 pairs with an expectation (50.0%)',
    );
    expect(md).toContain('mean 3.0, max 3.0');
  });

  it('has a matrix with per-run overalls, band marks, R and F', () => {
    expect(md).toContain('| CV | v1 | v2 |');
    expect(md).toContain('| cv1 | 82/79 ✓ R | 20 |');
    expect(md).toContain('| cv2 | 60/F ✗ R F | - |');
  });

  it('lists extracted criteria and coverage per vacancy', () => {
    expect(md).toContain('### v2: Data');
    expect(md).toContain('| c1 | must | PyTorch deep learning |');
    expect(md).toContain(
      'Coverage of required terms: 1/3. Missing: dbt, Spark.',
    );
  });

  it('has collapsible pair details with escaped cells and filler suspects', () => {
    expect(md).toContain('<details>');
    expect(md).toContain(
      '<summary>v1 x cv1, run 1: overall 82 (strong, expected strong), 1 attempt(s)</summary>',
    );
    expect(md).toContain(
      '| c1: Kafka | must | 82 | Used it | [cv] "Built Kafka \\| pipelines" |',
    );
    expect(md).toContain(
      '- c2 (score 0) quotes "Built Kafka | pipelines", also used for c1',
    );
    expect(md).toContain('**Grounding problems**');
    expect(md).toContain('FAILED, 2 attempt(s)');
    expect(md).toContain('Error: LlmGroundingError');
  });
});
