import type {
  RecordedCriterion,
  ScoreJobRecord,
  ScoreOkRecord,
} from '../eval/score-record.js';
import {
  citedCriteria,
  EVIDENCE_KS,
  evidenceRecall,
  quoteCovered,
  type CitedCriterion,
  type RankedChunk,
} from './recall.js';

const cv = (text: string): RankedChunk => ({ source: 'cv', text });
const gh = (text: string): RankedChunk => ({ source: 'github', text });

describe('quoteCovered', () => {
  it('matches across whitespace differences', () => {
    expect(
      quoteCovered({ source: 'cv', text: 'Built a CI pipeline' }, [
        cv('Summary\nBuilt a\nCI pipeline for 12 services'),
      ]),
    ).toBe(true);
  });

  it('matches a hyphen-wrapped unit', () => {
    expect(
      quoteCovered({ source: 'cv', text: 'Senior devel-oper' }, [
        cv('Senior devel-\noper at Acme'),
      ]),
    ).toBe(true);
  });

  it('never matches a chunk of the other source', () => {
    expect(
      quoteCovered({ source: 'cv', text: 'alpha repo' }, [gh('alpha repo')]),
    ).toBe(false);
  });

  it('does not match a quote split across two chunks', () => {
    expect(
      quoteCovered({ source: 'cv', text: 'first half second half' }, [
        cv('intro first half'),
        cv('second half outro'),
      ]),
    ).toBe(false);
  });
});

function ok(
  overrides: Partial<ScoreOkRecord>,
  criteria: RecordedCriterion[],
): ScoreOkRecord {
  return {
    key: 'k',
    vacancyId: 'v1',
    personaId: 'p1',
    mode: 'full_text',
    run: 1,
    at: '2026-11-22T00:00:00Z',
    status: 'ok',
    overall: 50,
    criteria,
    attempts: 1,
    inputTokens: 1,
    outputTokens: 1,
    costUsd: 0,
    ...overrides,
  };
}

const criterion = (
  id: string,
  quotes: RecordedCriterion['quotes'],
): RecordedCriterion => ({
  id,
  text: `criterion ${id}`,
  importance: 'must',
  score: 50,
  reasoning: '',
  quotes,
});

describe('citedCriteria', () => {
  it('keeps full_text run 1 ok criteria with quotes only', () => {
    const records: ScoreJobRecord[] = [
      ok({ key: 'a' }, [
        criterion('c1', [{ source: 'cv', text: 'x' }]),
        criterion('c2', []),
      ]),
      ok({ key: 'b', mode: 'rag' }, [
        criterion('c1', [{ source: 'cv', text: 'x' }]),
      ]),
      ok({ key: 'c', run: 2 }, [
        criterion('c1', [{ source: 'cv', text: 'x' }]),
      ]),
      {
        key: 'd',
        vacancyId: 'v1',
        personaId: 'p2',
        mode: 'full_text',
        run: 1,
        at: '2026-11-22T00:00:00Z',
        status: 'failed',
        failure: { kind: 'api', message: 'x' },
      },
    ];
    const items = citedCriteria(records);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      personaId: 'p1',
      vacancyId: 'v1',
      criterionId: 'c1',
      text: 'criterion c1',
    });
  });
});

describe('evidenceRecall', () => {
  // Item 1: quotes in ranks 1 and 3 of 3 chunks; item 2: a GitHub quote at
  // rank 2 and a CV quote no chunk contains.
  const items: CitedCriterion[] = [
    {
      key: 'i1',
      personaId: 'p1',
      vacancyId: 'v1',
      criterionId: 'c1',
      text: 't1',
      quotes: [
        { source: 'cv', text: 'alpha' },
        { source: 'cv', text: 'gamma' },
      ],
    },
    {
      key: 'i2',
      personaId: 'p2',
      vacancyId: 'v1',
      criterionId: 'c2',
      text: 't2',
      quotes: [
        { source: 'github', text: 'repo b' },
        { source: 'cv', text: 'missing' },
      ],
    },
  ];
  const rankings = new Map<string, RankedChunk[]>([
    ['i1', [cv('alpha 123'), cv('beta 1234'), cv('gamma 12')]],
    ['i2', [cv('zeta 1'), gh('repo b x')]],
  ]);
  const result = evidenceRecall(items, (item) => rankings.get(item.key)!);
  const row = (k: number | 'all') => result.rows.find((r) => r.k === k)!;

  it('counts the quotes and items', () => {
    expect(result).toMatchObject({
      items: 2,
      quotes: 4,
      quotesCv: 3,
      quotesGithub: 1,
    });
    expect(result.rows.map((r) => r.k)).toEqual([...EVIDENCE_KS, 'all']);
  });

  it('gives exact recall at k 1, 2 and all', () => {
    expect(row(1)).toMatchObject({
      quoteRecall: 1 / 4,
      quoteRecallCv: 1 / 3,
      quoteRecallGithub: 0,
      criterionAll: 0,
      criterionAny: 1 / 2,
    });
    expect(row(2)).toMatchObject({
      quoteRecall: 2 / 4,
      quoteRecallGithub: 1,
      criterionAll: 0,
      criterionAny: 1,
    });
    expect(row('all')).toMatchObject({
      quoteRecall: 3 / 4,
      criterionAll: 1 / 2,
      criterionAny: 1,
    });
  });

  it('reports context chars and the share of the candidate chunks', () => {
    // k 1: 9 and 6 chars; shares 1/3 and 1/2.
    expect(row(1).meanContextChars).toBeCloseTo((9 + 6) / 2, 10);
    expect(row(1).meanChunkShare).toBeCloseTo((1 / 3 + 1 / 2) / 2, 10);
    expect(row(10).meanChunkShare).toBe(1);
    expect(row(10)).toEqual({ ...row('all'), k: 10 });
  });

  it('is non-decreasing in k and at most 1', () => {
    const recalls = result.rows.map((r) => r.quoteRecall!);
    recalls.forEach((value, i) => {
      expect(value).toBeLessThanOrEqual(1);
      if (i > 0) expect(value).toBeGreaterThanOrEqual(recalls[i - 1]);
    });
  });

  it('leaves the GitHub recall undefined without GitHub quotes', () => {
    const only = evidenceRecall([items[0]], (item) => rankings.get(item.key)!);
    expect(only.rows[0].quoteRecallGithub).toBeNull();
  });
});
