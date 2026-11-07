import type { ChunkHit } from '../../db/repositories/candidate-chunks.repository.js';
import { rankCandidates, type RankOptions } from './rank-candidates.js';

const OPTIONS: RankOptions = {
  minSimilarity: 0.3,
  maxCandidates: 20,
  maxSnippets: 3,
};

function hit(
  candidateId: string,
  similarity: number,
  text = `${candidateId}-${similarity}`,
  source: ChunkHit['source'] = 'cv',
): ChunkHit {
  return { candidateId, source, text, similarity };
}

describe('rankCandidates', () => {
  it('returns [] for no hits', () => {
    expect(rankCandidates([], OPTIONS)).toEqual([]);
  });

  it('drops hits below the minimum but keeps ones exactly at it', () => {
    const result = rankCandidates(
      [hit('a', 0.29), hit('b', 0.3), hit('b', 0.1)],
      OPTIONS,
    );

    expect(result).toEqual([
      {
        candidateId: 'b',
        similarity: 0.3,
        snippets: [{ source: 'cv', text: 'b-0.3', similarity: 0.3 }],
      },
    ]);
  });

  it('returns [] when every hit is below the minimum', () => {
    expect(rankCandidates([hit('a', 0.1), hit('b', 0.2)], OPTIONS)).toEqual([]);
  });

  it('groups hits by candidate and scores the candidate by its best hit', () => {
    const result = rankCandidates(
      [hit('a', 0.5), hit('b', 0.9), hit('a', 0.7), hit('b', 0.4)],
      OPTIONS,
    );

    expect(result.map((r) => [r.candidateId, r.similarity])).toEqual([
      ['b', 0.9],
      ['a', 0.7],
    ]);
  });

  it('orders snippets best first and keeps source and text', () => {
    const result = rankCandidates(
      [
        hit('a', 0.4, 'low'),
        hit('a', 0.8, 'high', 'github'),
        hit('a', 0.6, 'mid'),
      ],
      OPTIONS,
    );

    expect(result[0].snippets).toEqual([
      { source: 'github', text: 'high', similarity: 0.8 },
      { source: 'cv', text: 'mid', similarity: 0.6 },
      { source: 'cv', text: 'low', similarity: 0.4 },
    ]);
  });

  it('caps the snippets per candidate', () => {
    const result = rankCandidates(
      [hit('a', 0.9), hit('a', 0.8), hit('a', 0.7), hit('a', 0.6)],
      { ...OPTIONS, maxSnippets: 2 },
    );

    expect(result[0].snippets.map((s) => s.similarity)).toEqual([0.9, 0.8]);
  });

  it('caps the number of candidates, keeping the best', () => {
    const result = rankCandidates(
      [hit('a', 0.5), hit('b', 0.9), hit('c', 0.7)],
      { ...OPTIONS, maxCandidates: 2 },
    );

    expect(result.map((r) => r.candidateId)).toEqual(['b', 'c']);
  });

  it('breaks similarity ties by candidate id', () => {
    const result = rankCandidates(
      [hit('c', 0.5), hit('a', 0.5), hit('b', 0.5)],
      OPTIONS,
    );

    expect(result.map((r) => r.candidateId)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate its input', () => {
    const hits = [hit('a', 0.4), hit('a', 0.9)];
    const copy = structuredClone(hits);

    rankCandidates(hits, OPTIONS);

    expect(hits).toEqual(copy);
  });
});
