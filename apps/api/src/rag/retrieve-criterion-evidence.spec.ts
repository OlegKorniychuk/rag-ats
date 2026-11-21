import { jest } from '@jest/globals';
import type { ChunkHit } from '../db/repositories/candidate-chunks.repository.js';
import { RAG_CHUNKS_PER_CRITERION } from './nearest-chunks.js';
import { retrieveCriterionEvidence } from './retrieve-criterion-evidence.js';

const CRITERIA = [
  { id: 'c1', text: 'TypeScript' },
  { id: 'c2', text: 'Docker' },
];

function hit(text: string, similarity: number): ChunkHit {
  return { candidateId: 'cand-1', source: 'cv', text, similarity };
}

function setup(hitsByVector: Record<number, ChunkHit[]>) {
  const embed = jest.fn(async (texts: string[]) => ({
    vectors: texts.map((_, i) => [i]),
  }));
  const findNearest = jest.fn(
    async (embedding: number[]): Promise<ChunkHit[]> =>
      hitsByVector[embedding[0]] ?? [],
  );
  return { embed, findNearest };
}

describe('retrieveCriterionEvidence', () => {
  it('embeds all criteria texts in one call', async () => {
    const { embed, findNearest } = setup({});

    await retrieveCriterionEvidence(
      { embed },
      { findNearest },
      'cand-1',
      CRITERIA,
    );

    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledWith(['TypeScript', 'Docker']);
  });

  it('looks up each criterion with its own vector, scoped to the candidate', async () => {
    const { embed, findNearest } = setup({});

    await retrieveCriterionEvidence(
      { embed },
      { findNearest },
      'cand-1',
      CRITERIA,
    );

    expect(findNearest).toHaveBeenCalledTimes(2);
    expect(findNearest).toHaveBeenNthCalledWith(
      1,
      [0],
      RAG_CHUNKS_PER_CRITERION,
      { candidateId: 'cand-1' },
    );
    expect(findNearest).toHaveBeenNthCalledWith(
      2,
      [1],
      RAG_CHUNKS_PER_CRITERION,
      { candidateId: 'cand-1' },
    );
  });

  it('keeps criteria and hit order, rounds similarity to 3 decimals and drops the candidate id', async () => {
    const { embed, findNearest } = setup({
      0: [hit('ts one', 0.87654), hit('ts two', 0.5)],
      1: [{ ...hit('docker', 0.12345), source: 'github' }],
    });

    const evidence = await retrieveCriterionEvidence(
      { embed },
      { findNearest },
      'cand-1',
      CRITERIA,
    );

    expect(evidence).toEqual([
      {
        criterionId: 'c1',
        chunks: [
          { source: 'cv', text: 'ts one', similarity: 0.877 },
          { source: 'cv', text: 'ts two', similarity: 0.5 },
        ],
      },
      {
        criterionId: 'c2',
        chunks: [{ source: 'github', text: 'docker', similarity: 0.123 }],
      },
    ]);
  });

  it('gives an empty chunk list to a criterion with no hits', async () => {
    const { embed, findNearest } = setup({ 1: [hit('docker', 0.4)] });

    const evidence = await retrieveCriterionEvidence(
      { embed },
      { findNearest },
      'cand-1',
      CRITERIA,
    );

    expect(evidence.map((e) => e.chunks.length)).toEqual([0, 1]);
  });
});
