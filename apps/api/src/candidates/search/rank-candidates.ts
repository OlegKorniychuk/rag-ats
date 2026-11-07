// Turns raw nearest-chunk hits into ranked candidates with their best
// snippets. Pure: no Nest, no I/O.

import type { ChunkHit } from '../../db/repositories/candidate-chunks.repository.js';

export interface RankOptions {
  /** Hits with a lower similarity are dropped. */
  minSimilarity: number;
  maxCandidates: number;
  maxSnippets: number;
}

export interface RankedSnippet {
  source: ChunkHit['source'];
  text: string;
  similarity: number;
}

export interface RankedCandidate {
  candidateId: string;
  /** The best hit's similarity. */
  similarity: number;
  /** Best first. */
  snippets: RankedSnippet[];
}

/**
 * Groups hits by candidate, scores each candidate by its best hit, and returns
 * the top `maxCandidates` (similarity descending, ties by candidate id) with
 * up to `maxSnippets` of their best hits each.
 */
export function rankCandidates(
  hits: ChunkHit[],
  { minSimilarity, maxCandidates, maxSnippets }: RankOptions,
): RankedCandidate[] {
  const byCandidate = new Map<string, RankedSnippet[]>();
  for (const hit of hits) {
    if (hit.similarity < minSimilarity) continue;
    const snippets = byCandidate.get(hit.candidateId) ?? [];
    snippets.push({
      source: hit.source,
      text: hit.text,
      similarity: hit.similarity,
    });
    byCandidate.set(hit.candidateId, snippets);
  }

  const ranked: RankedCandidate[] = [];
  for (const [candidateId, snippets] of byCandidate) {
    // Array.prototype.sort is stable: equal hits keep their input order.
    snippets.sort((a, b) => b.similarity - a.similarity);
    ranked.push({
      candidateId,
      similarity: snippets[0].similarity,
      snippets: snippets.slice(0, maxSnippets),
    });
  }

  ranked.sort(
    (a, b) =>
      b.similarity - a.similarity || a.candidateId.localeCompare(b.candidateId),
  );
  return ranked.slice(0, maxCandidates);
}
