import { cosineSimilarity, nearestChunks } from './nearest-chunks.js';

const chunk = (
  text: string,
  embedding: number[],
  source: 'cv' | 'github' = 'cv',
) => ({
  source,
  text,
  embedding,
});

describe('cosineSimilarity', () => {
  it('is 1 for parallel vectors regardless of length', () => {
    expect(cosineSimilarity([1, 2], [2, 4])).toBeCloseTo(1);
  });

  it('is 0 for orthogonal vectors and -1 for opposite ones', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it('is 0 when either vector is all zeros', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([1, 1], [0, 0])).toBe(0);
  });
});

describe('nearestChunks', () => {
  const chunks = [
    chunk('far', [0, 1]),
    chunk('near', [1, 0.1], 'github'),
    chunk('mid', [1, 1]),
  ];

  it('returns the k best chunks, best first, with source and similarity', () => {
    const result = nearestChunks([1, 0], chunks, 2);
    expect(result.map((c) => c.text)).toEqual(['near', 'mid']);
    expect(result[0].source).toBe('github');
    expect(result[0].similarity).toBeGreaterThan(result[1].similarity);
    expect(result[0]).not.toHaveProperty('embedding');
  });

  it('returns every chunk when k is at least the chunk count', () => {
    expect(nearestChunks([1, 0], chunks, 3)).toHaveLength(3);
    expect(nearestChunks([1, 0], chunks, 10)).toHaveLength(3);
  });

  it('keeps input order on equal similarity', () => {
    const tied = [chunk('a', [1, 0]), chunk('b', [2, 0]), chunk('c', [3, 0])];
    expect(nearestChunks([1, 0], tied, 3).map((c) => c.text)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('gives zero vectors similarity 0 and handles empty input or k = 0', () => {
    const result = nearestChunks([1, 0], [chunk('zero', [0, 0])], 1);
    expect(result).toEqual([{ source: 'cv', text: 'zero', similarity: 0 }]);
    expect(nearestChunks([1, 0], [], 3)).toEqual([]);
    expect(nearestChunks([1, 0], chunks, 0)).toEqual([]);
  });
});
