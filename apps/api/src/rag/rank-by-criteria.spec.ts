import type { VacancyCriterion } from '@rag-ats/shared';
import type { ChunkHit } from '../db/repositories/candidate-chunks.repository.js';
import {
  rankByCriteria,
  type RankByCriteriaOptions,
} from './rank-by-criteria.js';

const OPTIONS: RankByCriteriaOptions = {
  floor: 0.3,
  maxCandidates: 10,
  maxSnippets: 3,
};

function criterion(
  id: string,
  importance: VacancyCriterion['importance'],
): VacancyCriterion {
  return { id, text: `text of ${id}`, importance };
}

function hit(
  candidateId: string,
  similarity: number,
  text = `${candidateId}-${similarity}`,
  source: ChunkHit['source'] = 'cv',
): ChunkHit {
  return { candidateId, source, text, similarity };
}

describe('rankByCriteria', () => {
  it('returns [] for no criteria, even with hits', () => {
    expect(rankByCriteria([], [], OPTIONS)).toEqual([]);
    expect(rankByCriteria([], [[hit('a', 0.9)]], OPTIONS)).toEqual([]);
  });

  it('returns [] when no criterion has any hit', () => {
    expect(rankByCriteria([criterion('c1', 'must')], [[]], OPTIONS)).toEqual(
      [],
    );
  });

  it('weights must criteria double: score = sum(w*s) / sum(w)', () => {
    const [result] = rankByCriteria(
      [criterion('c1', 'must'), criterion('c2', 'nice')],
      [[hit('a', 0.6)], [hit('a', 0.9)]],
      OPTIONS,
    );

    expect(result.score).toBeCloseTo((2 * 0.6 + 0.9) / 3, 10);
  });

  it('counts an unmatched criterion as zero but keeps it in the denominator', () => {
    const [result] = rankByCriteria(
      [criterion('c1', 'must'), criterion('c2', 'nice')],
      [[hit('a', 0.8)], []],
      OPTIONS,
    );

    expect(result.score).toBeCloseTo((2 * 0.8) / 3, 10);
  });

  it('treats a similarity exactly at the floor as matched and just below as not', () => {
    const result = rankByCriteria(
      [criterion('c1', 'nice'), criterion('c2', 'nice')],
      [[hit('a', 0.3)], [hit('a', 0.299)]],
      OPTIONS,
    );

    expect(result).toHaveLength(1);
    expect(result[0].criteria).toEqual([
      expect.objectContaining({
        criterionId: 'c1',
        similarity: 0.3,
        matched: true,
      }),
      expect.objectContaining({
        criterionId: 'c2',
        similarity: 0.299,
        matched: false,
      }),
    ]);
    expect(result[0].score).toBeCloseTo(0.3 / 2, 10);
  });

  it('distinguishes a null similarity (not retrieved) from one below the floor', () => {
    const [result] = rankByCriteria(
      [
        criterion('c1', 'must'),
        criterion('c2', 'must'),
        criterion('c3', 'nice'),
      ],
      [[hit('a', 0.7)], [hit('a', 0.1)], []],
      OPTIONS,
    );

    expect(
      result.criteria.map((c) => [c.criterionId, c.similarity, c.matched]),
    ).toEqual([
      ['c1', 0.7, true],
      ['c2', 0.1, false],
      ['c3', null, false],
    ]);
  });

  it('uses the best of several hits per candidate and criterion', () => {
    const [result] = rankByCriteria(
      [criterion('c1', 'must')],
      [[hit('a', 0.4, 'low'), hit('a', 0.8, 'high'), hit('a', 0.5, 'mid')]],
      OPTIONS,
    );

    expect(result.criteria[0].similarity).toBe(0.8);
    expect(result.score).toBeCloseTo(0.8, 10);
    expect(result.snippets).toEqual([
      { source: 'cv', text: 'high', similarity: 0.8, criterionId: 'c1' },
    ]);
  });

  it('drops candidates with no matched criterion', () => {
    const result = rankByCriteria(
      [criterion('c1', 'must'), criterion('c2', 'nice')],
      [[hit('a', 0.2), hit('b', 0.5)], [hit('a', 0.1)]],
      OPTIONS,
    );

    expect(result.map((r) => r.candidateId)).toEqual(['b']);
  });

  it('sorts by score descending', () => {
    const result = rankByCriteria(
      [criterion('c1', 'must')],
      [[hit('a', 0.5), hit('b', 0.9), hit('c', 0.7)]],
      OPTIONS,
    );

    expect(result.map((r) => r.candidateId)).toEqual(['b', 'c', 'a']);
  });

  it('breaks score ties by matched must count, then by candidate id', () => {
    // a, m, z: must 0.3 -> 2*0.3/3 = 0.2; b, n: nice 0.6 -> 0.6/3 = 0.2
    const criteria = [criterion('c1', 'must'), criterion('c2', 'nice')];
    const result = rankByCriteria(
      criteria,
      [
        [hit('a', 0.3), hit('z', 0.3), hit('m', 0.3)],
        [hit('b', 0.6), hit('n', 0.6)],
      ],
      OPTIONS,
    );

    // equal scores: the candidates with a matched must come first
    const scores = result.map((r) => r.score);
    expect(scores[0]).toBeCloseTo(scores[4], 10);
    expect(result.map((r) => r.candidateId)).toEqual(['a', 'm', 'z', 'b', 'n']);
  });

  it('sorts equal scores and equal must counts by candidate id ascending', () => {
    const result = rankByCriteria(
      [criterion('c1', 'must')],
      [[hit('c', 0.5), hit('a', 0.5), hit('b', 0.5)]],
      OPTIONS,
    );

    expect(result.map((r) => r.candidateId)).toEqual(['a', 'b', 'c']);
  });

  it('lists criteria must first, then nice, each in input order', () => {
    const [result] = rankByCriteria(
      [
        criterion('n1', 'nice'),
        criterion('m1', 'must'),
        criterion('n2', 'nice'),
        criterion('m2', 'must'),
      ],
      [[hit('a', 0.5)], [hit('a', 0.5)], [hit('a', 0.5)], [hit('a', 0.5)]],
      OPTIONS,
    );

    expect(result.criteria.map((c) => c.criterionId)).toEqual([
      'm1',
      'm2',
      'n1',
      'n2',
    ]);
    expect(result.criteria[0]).toEqual({
      criterionId: 'm1',
      criterion: 'text of m1',
      importance: 'must',
      similarity: 0.5,
      matched: true,
    });
  });

  it('reads hitsPerCriterion by the position of the input criterion, not the output order', () => {
    const [result] = rankByCriteria(
      [criterion('n1', 'nice'), criterion('m1', 'must')],
      [[hit('a', 0.4)], [hit('a', 0.9)]],
      OPTIONS,
    );

    expect(result.criteria.map((c) => [c.criterionId, c.similarity])).toEqual([
      ['m1', 0.9],
      ['n1', 0.4],
    ]);
  });

  it('returns the best chunk of each matched criterion as snippets, best first', () => {
    const [result] = rankByCriteria(
      [
        criterion('c1', 'must'),
        criterion('c2', 'nice'),
        criterion('c3', 'nice'),
      ],
      [
        [hit('a', 0.5, 'k8s', 'github')],
        [hit('a', 0.9, 'react')],
        [hit('a', 0.1, 'unmatched')],
      ],
      OPTIONS,
    );

    expect(result.snippets).toEqual([
      { source: 'cv', text: 'react', similarity: 0.9, criterionId: 'c2' },
      { source: 'github', text: 'k8s', similarity: 0.5, criterionId: 'c1' },
    ]);
  });

  it('deduplicates snippets by text, keeping the higher-similarity criterion', () => {
    const [result] = rankByCriteria(
      [
        criterion('c1', 'must'),
        criterion('c2', 'must'),
        criterion('c3', 'nice'),
      ],
      [
        [hit('a', 0.5, 'shared')],
        [hit('a', 0.8, 'shared')],
        [hit('a', 0.4, 'other')],
      ],
      OPTIONS,
    );

    expect(result.snippets).toEqual([
      { source: 'cv', text: 'shared', similarity: 0.8, criterionId: 'c2' },
      { source: 'cv', text: 'other', similarity: 0.4, criterionId: 'c3' },
    ]);
    // both criteria still count as matched
    expect(result.criteria.filter((c) => c.matched)).toHaveLength(3);
  });

  it('caps snippets at maxSnippets, keeping the best', () => {
    const criteria = ['c1', 'c2', 'c3', 'c4'].map((id) =>
      criterion(id, 'nice'),
    );
    const [result] = rankByCriteria(
      criteria,
      [
        [hit('a', 0.4, 't1')],
        [hit('a', 0.9, 't2')],
        [hit('a', 0.6, 't3')],
        [hit('a', 0.5, 't4')],
      ],
      OPTIONS,
    );

    expect(result.snippets.map((s) => s.text)).toEqual(['t2', 't3', 't4']);
    expect(
      rankByCriteria(criteria, [[hit('a', 0.4)], [], [], []], {
        ...OPTIONS,
        maxSnippets: 0,
      })[0].snippets,
    ).toEqual([]);
  });

  it('does not fill the snippet cap with duplicates', () => {
    const criteria = ['c1', 'c2', 'c3', 'c4'].map((id) =>
      criterion(id, 'nice'),
    );
    const [result] = rankByCriteria(
      criteria,
      [
        [hit('a', 0.9, 'same')],
        [hit('a', 0.8, 'same')],
        [hit('a', 0.7, 'x')],
        [hit('a', 0.6, 'y')],
      ],
      OPTIONS,
    );

    expect(result.snippets.map((s) => s.text)).toEqual(['same', 'x', 'y']);
  });

  it('caps the candidates at maxCandidates after sorting', () => {
    const result = rankByCriteria(
      [criterion('c1', 'must')],
      [[hit('a', 0.4), hit('b', 0.9), hit('c', 0.6), hit('d', 0.5)]],
      { ...OPTIONS, maxCandidates: 2 },
    );

    expect(result.map((r) => r.candidateId)).toEqual(['b', 'c']);
  });

  it('ranks a candidate covering more criteria above a single strong match', () => {
    const result = rankByCriteria(
      [criterion('c1', 'must'), criterion('c2', 'must')],
      [[hit('broad', 0.5), hit('narrow', 0.9)], [hit('broad', 0.5)]],
      OPTIONS,
    );

    expect(result.map((r) => r.candidateId)).toEqual(['broad', 'narrow']);
  });
});
