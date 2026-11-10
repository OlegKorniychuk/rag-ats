import { UsageMeter } from './meter.js';
import {
  buildEvalChunks,
  coverageStats,
  embeddingCostUsd,
  estimateEmbedding,
  evidenceCoverage,
  ModeError,
  parseMode,
  previewChunk,
  retrieveForCriteria,
  toEvidence,
} from './rag.js';

const textChunks = [
  { source: 'cv' as const, text: 'Java and Spring at Acme' },
  { source: 'cv' as const, text: 'Kafka pipelines' },
  { source: 'cv' as const, text: 'Hobbies: chess' },
  { source: 'github' as const, text: 'Repo: kafka-demo (Java)' },
];
// 2-D fake vectors: x = backend-ish, y = streaming-ish.
const vectors = [
  [1, 0],
  [0, 1],
  [0.1, 0.1],
  [0.6, 0.8],
];
const chunks = buildEvalChunks(textChunks, vectors);

describe('parseMode', () => {
  it('defaults to full_text and accepts both modes', () => {
    expect(parseMode(undefined)).toBe('full_text');
    expect(parseMode('full_text')).toBe('full_text');
    expect(parseMode('rag')).toBe('rag');
  });

  it('rejects anything else as a usage error', () => {
    expect(() => parseMode('hybrid')).toThrow(ModeError);
    expect(() => parseMode('hybrid')).toThrow(/full_text, rag/);
    expect(() => parseMode('')).toThrow(ModeError);
  });
});

describe('buildEvalChunks', () => {
  it('numbers chunks ch1..chN in order and attaches vectors', () => {
    expect(chunks.map((c) => c.id)).toEqual(['ch1', 'ch2', 'ch3', 'ch4']);
    expect(chunks[3]).toMatchObject({
      source: 'github',
      embedding: [0.6, 0.8],
    });
  });

  it('rejects a vector count mismatch', () => {
    expect(() => buildEvalChunks(textChunks, vectors.slice(1))).toThrow(
      /expected 4 embedding/,
    );
  });
});

describe('retrieveForCriteria', () => {
  const criteria = [{ id: 'c1' }, { id: 'c2' }];
  const criterionVectors = [
    [1, 0], // backend
    [0, 1], // streaming
  ];

  it('returns the k nearest chunks per criterion, best first, with ids', () => {
    const result = retrieveForCriteria(criteria, criterionVectors, chunks, 2);
    expect(result.map((r) => r.criterionId)).toEqual(['c1', 'c2']);
    expect(result[0].chunks.map((c) => c.chunkId)).toEqual(['ch1', 'ch3']);
    expect(result[1].chunks.map((c) => c.chunkId)).toEqual(['ch2', 'ch4']);
    expect(result[0].chunks[0]).toEqual({
      chunkId: 'ch1',
      source: 'cv',
      similarity: 1,
      text: 'Java and Spring at Acme',
    });
  });

  it('caps at the number of chunks when k is larger', () => {
    const result = retrieveForCriteria([{ id: 'c1' }], [[1, 0]], chunks, 10);
    expect(result[0].chunks).toHaveLength(4);
  });

  it('keeps distinct ids for chunks with identical text', () => {
    const twins = buildEvalChunks(
      [
        { source: 'cv', text: 'same' },
        { source: 'cv', text: 'same' },
      ],
      [
        [1, 0],
        [1, 0],
      ],
    );
    const [r] = retrieveForCriteria([{ id: 'c1' }], [[1, 0]], twins, 2);
    expect(r.chunks.map((c) => c.chunkId)).toEqual(['ch1', 'ch2']);
  });

  it('rejects a vector count mismatch', () => {
    expect(() => retrieveForCriteria(criteria, [[1, 0]], chunks, 2)).toThrow(
      /expected 2 criterion embedding/,
    );
  });

  it('maps to the scorer evidence shape without ids', () => {
    const result = retrieveForCriteria([{ id: 'c1' }], [[1, 0]], chunks, 1);
    expect(toEvidence(result)).toEqual([
      {
        criterionId: 'c1',
        chunks: [
          { source: 'cv', text: 'Java and Spring at Acme', similarity: 1 },
        ],
      },
    ]);
  });
});

describe('evidenceCoverage', () => {
  it('counts distinct chunks shown over the candidate total', () => {
    const retrieval = retrieveForCriteria(
      [{ id: 'c1' }, { id: 'c2' }],
      [
        [1, 0],
        [0, 1],
      ],
      chunks,
      2,
    );
    // c1: ch1, ch3; c2: ch2, ch4 -> all four
    expect(evidenceCoverage(retrieval, 4)).toEqual({
      shown: 4,
      total: 4,
      ratio: 1,
    });
    // overlapping retrieval is counted once
    const overlap = retrieveForCriteria(
      [{ id: 'c1' }, { id: 'c2' }],
      [
        [1, 0],
        [1, 0],
      ],
      chunks,
      1,
    );
    expect(evidenceCoverage(overlap, 4)).toEqual({
      shown: 1,
      total: 4,
      ratio: 0.25,
    });
  });

  it('has no ratio for a candidate without chunks', () => {
    expect(evidenceCoverage([], 0)).toEqual({
      shown: 0,
      total: 0,
      ratio: null,
    });
  });
});

describe('coverageStats', () => {
  it('gives mean, min and max over pairs with a ratio', () => {
    const stats = coverageStats([
      { shown: 1, total: 4, ratio: 0.25 },
      { shown: 3, total: 4, ratio: 0.75 },
      { shown: 0, total: 0, ratio: null },
      undefined,
    ]);
    expect(stats).toEqual({ pairs: 2, mean: 0.5, min: 0.25, max: 0.75 });
  });

  it('is null when there is nothing to average', () => {
    expect(coverageStats([])).toBeNull();
    expect(coverageStats([undefined])).toBeNull();
  });
});

describe('embedding cost', () => {
  it('prices tokens per million', () => {
    expect(embeddingCostUsd(500_000, 0.02)).toBeCloseTo(0.01);
    expect(embeddingCostUsd(0, 0.02)).toBe(0);
  });

  it('the meter counts embedding tokens apart from chat usage', () => {
    const meter = new UsageMeter();
    const usage = (i: number) => ({
      model: 'm',
      inputTokens: i,
      outputTokens: 0,
      totalTokens: i,
    });
    meter.recordEmbedding(usage(120));
    meter.recordEmbedding(usage(30));
    meter.recordEmbedding(null);
    expect(meter.embeddingTokens).toBe(150);
    expect(meter.usage).toBeNull();
    expect(meter.attempts).toBe(0);
    meter.reset();
    expect(meter.embeddingTokens).toBe(0);
  });
});

describe('estimateEmbedding', () => {
  it('estimates chunks once and criteria per run, with cost', () => {
    const estimate = estimateEmbedding({
      chunkTexts: [['a'.repeat(400), 'b'.repeat(40)], ['c'.repeat(80)]],
      requirementTexts: ['d'.repeat(200)],
      runs: 2,
      pricePerMillion: 0.02,
    });
    expect(estimate.chunkTokens).toBe(100 + 10 + 20);
    expect(estimate.criteriaTokens).toBe(50 * 2);
    expect(estimate.totalTokens).toBe(230);
    expect(estimate.costUsd).toBeCloseTo((230 * 0.02) / 1_000_000);
  });
});

describe('previewChunk', () => {
  it('shows id, source, similarity and a shortened flat text', () => {
    expect(
      previewChunk({
        chunkId: 'ch2',
        source: 'cv',
        similarity: 0.612,
        text: 'x'.repeat(100),
      }),
    ).toBe(`ch2 [cv] 0.61 "${'x'.repeat(60)}..."`);
    expect(
      previewChunk({
        chunkId: 'ch1',
        source: 'github',
        similarity: 1,
        text: 'a\n  b',
      }),
    ).toBe('ch1 [github] 1.00 "a b"');
  });
});
