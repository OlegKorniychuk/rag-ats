import type { GithubSnapshot } from '../../github/github-snapshot.js';
import type { CandidateEmbedState } from '../../db/repositories/candidates.repository.js';
import type { NewCandidateChunk } from '../../db/repositories/candidate-chunks.repository.js';
import { reindexAll, type ReindexDeps } from './reindex.js';

const cvText = Array.from(
  { length: 40 },
  (_, i) => `Line ${i}: built and shipped a service with tests.`,
).join('\n');

function fakeDeps(spent = { usd: 0 }) {
  const states: Record<string, CandidateEmbedState> = {
    a: {
      parseStatus: 'parsed',
      parsedCvDocumentId: 'cv-a',
      embeddedCvDocumentId: 'cv-a',
    },
    b: {
      parseStatus: 'failed',
      parsedCvDocumentId: null,
      embeddedCvDocumentId: null,
    },
    c: {
      parseStatus: 'parsed',
      parsedCvDocumentId: 'cv-c',
      embeddedCvDocumentId: 'cv-c',
    },
  };
  const saved: Array<{
    candidateId: string;
    cvDocumentId: string;
    chunks: NewCandidateChunk[];
  }> = [];
  const embedCalls: string[][] = [];
  const deps: ReindexDeps = {
    candidateIds: async () => Object.keys(states),
    embedState: async (id) => states[id] ?? null,
    cvText: async () => cvText,
    snapshot: async (): Promise<GithubSnapshot | null> => null,
    embed: async (texts) => {
      embedCalls.push(texts);
      spent.usd += 0.01;
      return texts.map(() => [0.1, 0.2]);
    },
    save: async (candidateId, cvDocumentId, chunks) => {
      saved.push({ candidateId, cvDocumentId, chunks });
    },
    spentUsd: () => spent.usd,
  };
  return { deps, saved, embedCalls };
}

describe('reindexAll', () => {
  it('re-chunks and saves every parsed candidate at the given size', async () => {
    const { deps, saved } = fakeDeps();
    const summary = await reindexAll(deps, {
      cvMaxChars: 500,
      dryRun: false,
      maxUsd: 1,
      pricePerMillion: 0.02,
    });

    expect(saved.map((s) => [s.candidateId, s.cvDocumentId])).toEqual([
      ['a', 'cv-a'],
      ['c', 'cv-c'],
    ]);
    for (const s of saved) {
      expect(s.chunks.length).toBeGreaterThan(1);
      expect(
        s.chunks.every((c) => c.source === 'cv' && c.text.length <= 500),
      ).toBe(true);
      expect(s.chunks.every((c) => c.embedding.length === 2)).toBe(true);
    }
    expect(summary.candidates).toBe(2);
    expect(summary.skipped).toBe(1);
    expect(summary.chunks.cv).toBe(saved[0].chunks.length * 2);
    expect(summary.chunks.github).toBe(0);
    expect(summary.maxCvChunkChars).toBeLessThanOrEqual(500);
    expect(summary.stopped).toBeNull();
  });

  it('dry run neither embeds nor saves, and estimates tokens as chars / 4', async () => {
    const { deps, saved, embedCalls } = fakeDeps();
    const summary = await reindexAll(deps, {
      cvMaxChars: 1000,
      dryRun: true,
      maxUsd: 1,
      pricePerMillion: 0.02,
    });
    expect(saved).toHaveLength(0);
    expect(embedCalls).toHaveLength(0);
    expect(summary.candidates).toBe(2);
    expect(summary.estimatedTokens).toBe(Math.ceil(summary.totalChars / 4));
    expect(summary.estimatedUsd).toBeCloseTo(
      (summary.estimatedTokens * 0.02) / 1_000_000,
      12,
    );
  });

  it('stops before a candidate that would pass the cap', async () => {
    const spent = { usd: 0 };
    const { deps, saved } = fakeDeps(spent);
    spent.usd = 0.9999999;
    const summary = await reindexAll(deps, {
      cvMaxChars: 1000,
      dryRun: false,
      maxUsd: 1,
      pricePerMillion: 0.02,
    });
    expect(saved).toHaveLength(0);
    expect(summary.stopped).toBe('budget');
  });
});
