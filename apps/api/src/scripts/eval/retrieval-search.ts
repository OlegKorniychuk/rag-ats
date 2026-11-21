/**
 * Search eval: the production `CandidateSearchService.search` over the 20
 * queries, plus the floor sweep (the same nearest chunks re-ranked at other
 * floors). Read-only; the only external call is the query embedding.
 */
import type {
  CandidateSearchService,
  CandidateSearchTrace,
} from '../../candidates/search/candidate-search.service.js';
import { rankCandidates } from '../../candidates/search/rank-candidates.js';
import {
  MAX_RESULTS,
  MAX_SNIPPETS,
} from '../../candidates/search/search.constants.js';
import type { ChunkHit } from '../../db/repositories/candidate-chunks.repository.js';
import type { SearchQuery } from '../synth/types.js';
import { mean, reciprocalRank, type Gains, type Maybe } from './metrics.js';
import {
  meanRankMetrics,
  rankMetrics,
  type RankMetrics,
} from './retrieval-metrics.js';

/** Floors of the sweep (sdd §12: what the fixed `MIN_SIMILARITY` costs). */
export const SWEEP_FLOORS: readonly number[] = [0.2, 0.25, 0.3, 0.35];

export interface SearchMetrics extends RankMetrics {
  /** Reciprocal rank of the first fully relevant persona (partial does not count). */
  rr: Maybe;
}

export interface SearchQueryResult {
  queryId: string;
  query: string;
  relevant: number;
  partiallyRelevant: number;
  /** Candidates returned. */
  returned: number;
  /** Ranked persona ids, best first (a candidate outside the set keeps its candidate id). */
  ranked: string[];
  /** Returned candidates that are not a persona of the set. */
  unmapped: number;
  metrics: SearchMetrics;
}

export interface SearchMeans {
  metrics: SearchMetrics;
  returned: Maybe;
}

export interface FloorSweepRow extends SearchMeans {
  floor: number;
  queries: Array<{
    queryId: string;
    returned: number;
    ranked: string[];
    metrics: SearchMetrics;
  }>;
}

export interface SearchEval extends SearchMeans {
  /** The floor the production service ran with (the sweep row at this floor equals `queries`). */
  productionFloor: number;
  queries: SearchQueryResult[];
  sweep: FloorSweepRow[];
}

export interface SearchEvalOptions {
  productionFloor: number;
  sweepFloors?: readonly number[];
}

/** Gains of a query: relevant 1, partially relevant 0.5 (relevant wins if listed twice). */
export function queryGains(query: SearchQuery): Gains {
  const gains = new Map<string, number>();
  for (const id of query.partiallyRelevant ?? []) gains.set(id, 0.5);
  for (const id of query.relevant ?? []) gains.set(id, 1);
  return gains;
}

function searchMetrics(ranked: readonly string[], gains: Gains): SearchMetrics {
  return { ...rankMetrics(ranked, gains), rr: reciprocalRank(ranked, gains) };
}

function meanSearchMetrics(rows: readonly SearchMetrics[]): SearchMetrics {
  return { ...meanRankMetrics(rows), rr: mean(rows.map((r) => r.rr)) };
}

/** Persona ids of candidate ids; an unknown candidate keeps its own id. */
function toPersonas(
  candidateIds: readonly string[],
  personaIdByCandidateId: ReadonlyMap<string, string>,
): { ranked: string[]; unmapped: number } {
  let unmapped = 0;
  const ranked = candidateIds.map((id) => {
    const persona = personaIdByCandidateId.get(id);
    if (persona === undefined) unmapped += 1;
    return persona ?? id;
  });
  return { ranked, unmapped };
}

export type SearchSource = Pick<CandidateSearchService, 'searchWithHits'>;

/**
 * Runs every query once (one embedding each). The production result is the
 * service's own; the sweep re-ranks the same `hits` with `rankCandidates` and
 * the service's cap and snippet count, so its row at the production floor
 * equals the production result.
 */
export async function evaluateSearch(
  service: SearchSource,
  queries: readonly SearchQuery[],
  personaIdByCandidateId: ReadonlyMap<string, string>,
  options: SearchEvalOptions,
): Promise<SearchEval> {
  const floors = options.sweepFloors ?? SWEEP_FLOORS;
  const traces: Array<{ query: SearchQuery; trace: CandidateSearchTrace }> = [];
  for (const query of queries) {
    traces.push({ query, trace: await service.searchWithHits(query.query) });
  }

  const rows = traces.map(({ query, trace }): SearchQueryResult => {
    const gains = queryGains(query);
    const { ranked, unmapped } = toPersonas(
      trace.results.map((r) => r.candidate.id),
      personaIdByCandidateId,
    );
    return {
      queryId: query.id,
      query: query.query,
      relevant: query.relevant?.length ?? 0,
      partiallyRelevant: query.partiallyRelevant?.length ?? 0,
      returned: ranked.length,
      ranked,
      unmapped,
      metrics: searchMetrics(ranked, gains),
    };
  });

  const sweep = floors.map((floor): FloorSweepRow => {
    const perQuery = traces.map(({ query, trace }) => {
      const ranked = rankAt(trace.hits, floor, personaIdByCandidateId);
      return {
        queryId: query.id,
        returned: ranked.length,
        ranked,
        metrics: searchMetrics(ranked, queryGains(query)),
      };
    });
    return {
      floor,
      queries: perQuery,
      metrics: meanSearchMetrics(perQuery.map((q) => q.metrics)),
      returned: mean(perQuery.map((q) => q.returned)),
    };
  });

  return {
    productionFloor: options.productionFloor,
    queries: rows,
    metrics: meanSearchMetrics(rows.map((r) => r.metrics)),
    returned: mean(rows.map((r) => r.returned)),
    sweep,
  };
}

function rankAt(
  hits: ChunkHit[],
  floor: number,
  personaIdByCandidateId: ReadonlyMap<string, string>,
): string[] {
  const ranked = rankCandidates(hits, {
    minSimilarity: floor,
    maxCandidates: MAX_RESULTS,
    maxSnippets: MAX_SNIPPETS,
  });
  return toPersonas(
    ranked.map((r) => r.candidateId),
    personaIdByCandidateId,
  ).ranked;
}
