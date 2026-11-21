/**
 * Retrieval eval (plan step 11, task 4): candidate search with a floor sweep,
 * and find-matches in both modes over the whole pool, with G5. Read-only; the
 * only LLM traffic is embeddings, through the metered client.
 */
import type { INestApplicationContext } from '@nestjs/common';
import { CandidateSearchService } from '../../candidates/search/candidate-search.service.js';
import {
  MAX_RESULTS,
  MAX_SNIPPETS,
  MIN_SIMILARITY,
  SEARCH_CHUNK_LIMIT,
  SEARCH_MIN_SIMILARITY,
} from '../../candidates/search/search.constants.js';
import {
  CANDIDATE_CHUNKS_REPOSITORY,
  type CandidateChunksRepository,
} from '../../db/repositories/candidate-chunks.repository.js';
import {
  VACANCIES_REPOSITORY,
  type VacanciesRepository,
} from '../../db/repositories/vacancies.repository.js';
import { LlmClient } from '../../llm/llm-client.js';
import {
  MAX_MATCH_SNIPPETS,
  PER_CRITERION_CHUNK_LIMIT,
  WHOLE_TEXT_CHUNK_LIMIT,
} from '../../vacancies/matches/matches.constants.js';
import type { EvalDataset } from './preflight.js';
import {
  DEFAULT_MATCH_FLOORS,
  evaluateMatches,
  type G5Result,
  type MatchDeps,
  type MatchesEval,
  type MatchFloors,
  type MatchModeResult,
  type VacancyText,
} from './retrieval-matches.js';
import {
  evaluateSearch,
  SWEEP_FLOORS,
  type SearchEval,
  type SearchSource,
} from './retrieval-search.js';

export type {
  FloorSweepRow,
  SearchEval,
  SearchMetrics,
  SearchQueryResult,
} from './retrieval-search.js';
export type {
  G5Example,
  G5Result,
  MatchModeResult,
  MatchedCriterion,
  VacancyMatchResult,
} from './retrieval-matches.js';
export type { RankMetrics } from './retrieval-metrics.js';

/** The production settings the run used, for the report. */
export interface RetrievalSettings {
  search: {
    chunkLimit: number;
    floor: number;
    maxResults: number;
    maxSnippets: number;
    sweepFloors: readonly number[];
  };
  matches: {
    criteriaFloor: number;
    wholeTextFloor: number;
    perCriterionChunkLimit: number;
    wholeTextChunkLimit: number;
    maxSnippets: number;
    /** Candidates ranked per vacancy (the whole pool, not the API's 10). */
    maxCandidates: number;
    excludesApplicants: false;
  };
}

export interface RetrievalResult {
  settings: RetrievalSettings;
  search: SearchEval;
  matches: Record<'criteria' | 'whole_text', MatchModeResult>;
  g5: Record<'criteria' | 'whole_text', G5Result>;
}

export interface RetrievalOptions {
  /** Override the floors (the integration test: the fake embedding model scores low). */
  matchFloors?: MatchFloors;
  sweepFloors?: readonly number[];
}

/** Everything `runRetrievalEval` reads, so unit tests can supply fakes. */
export interface RetrievalDeps {
  search: SearchSource;
  matches: MatchDeps;
  /** The service's injected floor. */
  searchFloor: number;
  /** DB title and requirements by seeded vacancy id. */
  vacancyTexts: ReadonlyMap<string, VacancyText>;
}

export async function retrieveAll(
  deps: RetrievalDeps,
  dataset: EvalDataset,
  options: RetrievalOptions = {},
): Promise<RetrievalResult> {
  const sweepFloors = options.sweepFloors ?? SWEEP_FLOORS;
  const floors: MatchFloors = options.matchFloors ?? {
    ...DEFAULT_MATCH_FLOORS,
    wholeText: deps.searchFloor,
  };
  const search = await evaluateSearch(
    deps.search,
    dataset.queries,
    dataset.personaIdByCandidateId,
    { productionFloor: deps.searchFloor, sweepFloors },
  );
  const matches: MatchesEval = await evaluateMatches(deps.matches, {
    dataset,
    texts: deps.vacancyTexts,
    floors,
  });
  return {
    settings: {
      search: {
        chunkLimit: SEARCH_CHUNK_LIMIT,
        floor: deps.searchFloor,
        maxResults: MAX_RESULTS,
        maxSnippets: MAX_SNIPPETS,
        sweepFloors,
      },
      matches: {
        criteriaFloor: matches.floors.criteria,
        wholeTextFloor: matches.floors.wholeText,
        perCriterionChunkLimit: PER_CRITERION_CHUNK_LIMIT,
        wholeTextChunkLimit: WHOLE_TEXT_CHUNK_LIMIT,
        maxSnippets: MAX_MATCH_SNIPPETS,
        maxCandidates: matches.poolSize,
        excludesApplicants: false,
      },
    },
    search,
    matches: matches.results,
    g5: matches.g5,
  };
}

/**
 * The retrieval eval against the seeded database. Search goes through the
 * production `CandidateSearchService`; matches use the repository's
 * `findNearest` and the pure rankers. Embeddings only (metered); no writes.
 */
export async function runRetrievalEval(
  app: INestApplicationContext,
  dataset: EvalDataset,
  options: RetrievalOptions = {},
): Promise<RetrievalResult> {
  const chunks = app.get<CandidateChunksRepository>(
    CANDIDATE_CHUNKS_REPOSITORY,
  );
  const vacancies = app.get<VacanciesRepository>(VACANCIES_REPOSITORY);
  const llm = app.get(LlmClient);

  // The DB title and requirements, exactly what `VacancyMatchService` embeds.
  const vacancyTexts = new Map<string, VacancyText>();
  for (const vacancy of dataset.vacancies) {
    const stored = await vacancies.findCriteria(vacancy.id);
    if (!stored) throw new Error(`Vacancy ${vacancy.spec.id} not found`);
    vacancyTexts.set(vacancy.id, {
      title: stored.title,
      requirements: stored.requirements,
    });
  }

  let searchFloor = MIN_SIMILARITY;
  try {
    searchFloor = app.get<number>(SEARCH_MIN_SIMILARITY);
  } catch {
    // not provided: the production default
  }

  return retrieveAll(
    {
      search: app.get(CandidateSearchService),
      matches: {
        embed: async (texts) => (await llm.embed(texts)).vectors,
        findNearest: (vector, limit) => chunks.findNearest(vector, limit),
      },
      searchFloor,
      vacancyTexts,
    },
    dataset,
    options,
  );
}
