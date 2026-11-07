// Ranks candidates by how well their chunks cover a vacancy's criteria, from
// the nearest-chunk hits retrieved per criterion. Pure: no Nest, no I/O.

import type { CriterionImportance, VacancyCriterion } from '@rag-ats/shared';
import type { ChunkHit } from '../db/repositories/candidate-chunks.repository.js';

export interface RankByCriteriaOptions {
  /** A criterion counts as matched at or above this best-chunk similarity. */
  floor: number;
  maxCandidates: number;
  maxSnippets: number;
}

export interface RankedCriterion {
  criterionId: string;
  criterion: string;
  importance: CriterionImportance;
  /** Best similarity among the criterion's hits for the candidate; null if none. */
  similarity: number | null;
  /** similarity is at or above the floor. */
  matched: boolean;
}

export interface CriteriaSnippet {
  source: ChunkHit['source'];
  text: string;
  similarity: number;
  /** The criterion the chunk was retrieved for. */
  criterionId: string;
}

export interface CriteriaRankedCandidate {
  candidateId: string;
  /** Weighted criterion coverage, 0-1. */
  score: number;
  /** Every criterion, must first, then nice, each in input order. */
  criteria: RankedCriterion[];
  /** Best chunk of each matched criterion, best first, deduplicated by text. */
  snippets: CriteriaSnippet[];
}

const WEIGHTS: Record<CriterionImportance, number> = { must: 2, nice: 1 };

interface Best {
  similarity: number;
  hit: ChunkHit;
}

/**
 * `hitsPerCriterion[i]` holds the hits retrieved for `criteria[i]`.
 *
 * Per candidate and criterion the best hit decides the similarity. The score is
 * `sum(w * s) / sum(w)` over all criteria with w = 2 for `must` and 1 for
 * `nice`, and s = the similarity when matched, else 0. Candidates matching no
 * criterion are dropped; the rest sort by score, then matched `must` count
 * (both descending), then candidate id. At most `maxCandidates` are returned.
 */
export function rankByCriteria(
  criteria: VacancyCriterion[],
  hitsPerCriterion: ChunkHit[][],
  { floor, maxCandidates, maxSnippets }: RankByCriteriaOptions,
): CriteriaRankedCandidate[] {
  if (criteria.length === 0) return [];

  // Output order: must before nice, input order within each group. The sort is
  // stable, so `ordered` keeps the input order inside each importance.
  const ordered = criteria
    .map((criterion, index) => ({ criterion, index }))
    .sort(
      (a, b) =>
        WEIGHTS[b.criterion.importance] - WEIGHTS[a.criterion.importance],
    );
  const totalWeight = criteria.reduce(
    (sum, c) => sum + WEIGHTS[c.importance],
    0,
  );

  // candidateId -> best hit per criterion index
  const bestByCandidate = new Map<string, Map<number, Best>>();
  hitsPerCriterion.forEach((hits, index) => {
    if (index >= criteria.length) return;
    for (const hit of hits) {
      const best = bestByCandidate.get(hit.candidateId) ?? new Map();
      const current = best.get(index);
      if (!current || hit.similarity > current.similarity) {
        best.set(index, { similarity: hit.similarity, hit });
      }
      bestByCandidate.set(hit.candidateId, best);
    }
  });

  const ranked: (CriteriaRankedCandidate & { matchedMust: number })[] = [];
  for (const [candidateId, best] of bestByCandidate) {
    let weighted = 0;
    let matchedCount = 0;
    let matchedMust = 0;
    const candidateCriteria: RankedCriterion[] = [];
    const candidateSnippets: CriteriaSnippet[] = [];

    for (const { criterion, index } of ordered) {
      const found = best.get(index);
      const similarity = found?.similarity ?? null;
      const matched = similarity !== null && similarity >= floor;
      candidateCriteria.push({
        criterionId: criterion.id,
        criterion: criterion.text,
        importance: criterion.importance,
        similarity,
        matched,
      });
      if (!matched || !found) continue;
      weighted += WEIGHTS[criterion.importance] * found.similarity;
      matchedCount += 1;
      if (criterion.importance === 'must') matchedMust += 1;
      candidateSnippets.push({
        source: found.hit.source,
        text: found.hit.text,
        similarity: found.similarity,
        criterionId: criterion.id,
      });
    }
    if (matchedCount === 0) continue;

    // Stable sort: equal similarities keep the must-first criterion order.
    candidateSnippets.sort((a, b) => b.similarity - a.similarity);
    const seen = new Set<string>();
    const snippets: CriteriaSnippet[] = [];
    for (const snippet of candidateSnippets) {
      if (snippets.length >= maxSnippets) break;
      if (seen.has(snippet.text)) continue;
      seen.add(snippet.text);
      snippets.push(snippet);
    }

    ranked.push({
      candidateId,
      score: weighted / totalWeight,
      criteria: candidateCriteria,
      snippets,
      matchedMust,
    });
  }

  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      b.matchedMust - a.matchedMust ||
      a.candidateId.localeCompare(b.candidateId),
  );
  return ranked
    .slice(0, maxCandidates)
    .map(({ candidateId, score, criteria, snippets }) => ({
      candidateId,
      score,
      criteria,
      snippets,
    }));
}
