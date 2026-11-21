/**
 * Find-matches eval, both modes, over the whole pool. Mirrors
 * `VacancyMatchService` (same rankers, floors and chunk limits) with the two
 * differences the report states: no applicant exclusion (`findNearest` gets no
 * `excludeVacancyId`) and no cap of 10 (`maxCandidates` = pool size).
 */
import type { MatchMode, VacancyCriterion } from '@rag-ats/shared';
import { rankCandidates } from '../../candidates/search/rank-candidates.js';
import { MIN_SIMILARITY } from '../../candidates/search/search.constants.js';
import type { ChunkHit } from '../../db/repositories/candidate-chunks.repository.js';
import { rankByCriteria } from '../../rag/rank-by-criteria.js';
import {
  MATCH_FLOOR,
  MAX_MATCH_SNIPPETS,
  PER_CRITERION_CHUNK_LIMIT,
  WHOLE_TEXT_CHUNK_LIMIT,
} from '../../vacancies/matches/matches.constants.js';
import type { Band, GroundTruth } from '../synth/types.js';
import { mean, type Gains, type Maybe } from './metrics.js';
import type { EvalDataset, EvalVacancy } from './preflight.js';
import {
  meanRankMetrics,
  rankMetrics,
  type RankMetrics,
} from './retrieval-metrics.js';

export const MATCH_MODES: readonly MatchMode[] = ['criteria', 'whole_text'];

/** The top of the list G5 looks at. */
export const G5_TOP = 10;
/** Worst examples kept per mode. */
export const G5_EXAMPLES = 3;
const SNIPPET_CHARS = 200;

const BAND_GAIN: Record<Band, number> = { strong: 1, partial: 0.5, weak: 0 };

/** What the matching reads from outside: embeddings and the vector index. */
export interface MatchDeps {
  embed(texts: string[]): Promise<number[][]>;
  /** No options: the eval never excludes applicants. */
  findNearest(vector: number[], limit: number): Promise<ChunkHit[]>;
}

/** The vacancy text as the DB holds it (what `VacancyMatchService` embeds). */
export interface VacancyText {
  title: string;
  requirements: string;
}

export interface MatchFloors {
  /** `criteria` mode: a criterion counts as matched at or above this. */
  criteria: number;
  /** `whole_text` mode: chunks below this are dropped. */
  wholeText: number;
}

export const DEFAULT_MATCH_FLOORS: MatchFloors = {
  criteria: MATCH_FLOOR,
  wholeText: MIN_SIMILARITY,
};

export interface MatchedCriterion {
  criterionId: string;
  criterion: string;
  similarity: number;
}

/** One ranked candidate of a vacancy, before metrics. */
interface RankedRow {
  personaId: string;
  score: number;
  /** Matched criteria (`criteria` mode only). */
  matched: MatchedCriterion[];
  topSnippet: string | null;
}

export interface VacancyMatchResult {
  /** The vacancy's id in vacancies.json. */
  vacancyId: string;
  title: string;
  /** Personas ranked, best first (the whole list, no cap). */
  returned: number;
  ranked: string[];
  /** Personas of the vacancy's ground truth, by band. */
  bands: { strong: number; partial: number; weak: number };
  metrics: RankMetrics;
  /** Weak-band personas among the first 10 ranked. */
  weakInTop10: number;
  /** `weakInTop10` over min(10, returned); null when nothing came back. */
  weakShareTop10: Maybe;
}

export interface MatchModeResult {
  mode: MatchMode;
  vacancies: VacancyMatchResult[];
  metrics: RankMetrics;
  returned: Maybe;
}

export interface G5Example {
  personaId: string;
  /** 1-based rank in the vacancy's list. */
  rank: number;
  vacancyId: string;
  title: string;
  score: number;
  /** The criteria it matched (`criteria` mode; empty in `whole_text`). */
  matchedCriteria: MatchedCriterion[];
  /** Best snippet, cut to about 200 characters. */
  snippet: string | null;
}

export interface G5Result {
  mode: MatchMode;
  /** Mean over vacancies of the weak share (vacancies with no results skipped). */
  meanWeakShare: Maybe;
  /** Weak personas over all top-10 slots, pooled across vacancies. */
  pooledWeakShare: Maybe;
  /** Highest-ranked weak personas first. */
  worst: G5Example[];
}

export interface MatchesEval {
  results: Record<MatchMode, MatchModeResult>;
  g5: Record<MatchMode, G5Result>;
  floors: MatchFloors;
  /** Every mode ranks up to this many candidates (the whole pool). */
  poolSize: number;
}

/** Gains of a vacancy from the rule's bands: strong 1, partial 0.5, weak 0. */
export function vacancyGains(
  groundTruth: GroundTruth,
  vacancyId: string,
): { gains: Gains; bands: Map<string, Band> } {
  const gains = new Map<string, number>();
  const bands = new Map<string, Band>();
  for (const pair of groundTruth.pairs) {
    if (pair.vacancyId !== vacancyId) continue;
    gains.set(pair.personaId, BAND_GAIN[pair.band]);
    bands.set(pair.personaId, pair.band);
  }
  return { gains, bands };
}

const truncate = (text: string): string =>
  text.length <= SNIPPET_CHARS ? text : `${text.slice(0, SNIPPET_CHARS)}...`;

/** `criteria` mode: one embedding call for all criteria, `rankByCriteria`. */
async function rankCriteriaMode(
  deps: MatchDeps,
  criteria: VacancyCriterion[],
  floor: number,
  poolSize: number,
  personaOf: (candidateId: string) => string,
): Promise<RankedRow[]> {
  const vectors = await deps.embed(criteria.map((c) => c.text));
  const hitsPerCriterion = await Promise.all(
    vectors.map((vector) =>
      deps.findNearest(vector, PER_CRITERION_CHUNK_LIMIT),
    ),
  );
  return rankByCriteria(criteria, hitsPerCriterion, {
    floor,
    maxCandidates: poolSize,
    maxSnippets: MAX_MATCH_SNIPPETS,
  }).map((r) => ({
    personaId: personaOf(r.candidateId),
    score: r.score,
    matched: r.criteria
      .filter((c) => c.matched && c.similarity !== null)
      .map((c) => ({
        criterionId: c.criterionId,
        criterion: c.criterion,
        similarity: c.similarity as number,
      })),
    topSnippet: r.snippets[0]?.text ?? null,
  }));
}

/** `whole_text` mode: embed `title\nrequirements`, `rankCandidates`. */
async function rankWholeTextMode(
  deps: MatchDeps,
  text: VacancyText,
  floor: number,
  poolSize: number,
  personaOf: (candidateId: string) => string,
): Promise<RankedRow[]> {
  const [vector] = await deps.embed([`${text.title}\n${text.requirements}`]);
  const hits = await deps.findNearest(vector, WHOLE_TEXT_CHUNK_LIMIT);
  return rankCandidates(hits, {
    minSimilarity: floor,
    maxCandidates: poolSize,
    maxSnippets: MAX_MATCH_SNIPPETS,
  }).map((r) => ({
    personaId: personaOf(r.candidateId),
    score: r.similarity,
    matched: [],
    topSnippet: r.snippets[0]?.text ?? null,
  }));
}

interface VacancyEval {
  result: VacancyMatchResult;
  /** Weak personas in the top 10, best rank first. */
  weakExamples: G5Example[];
}

function evaluateVacancy(
  vacancy: EvalVacancy,
  rows: readonly RankedRow[],
  groundTruth: GroundTruth,
): VacancyEval {
  const { gains, bands } = vacancyGains(groundTruth, vacancy.spec.id);
  const ranked = rows.map((r) => r.personaId);
  const top = rows.slice(0, G5_TOP);
  const weakExamples = top.flatMap((row, i): G5Example[] =>
    bands.get(row.personaId) === 'weak'
      ? [
          {
            personaId: row.personaId,
            rank: i + 1,
            vacancyId: vacancy.spec.id,
            title: vacancy.spec.title,
            score: row.score,
            matchedCriteria: row.matched,
            snippet: row.topSnippet === null ? null : truncate(row.topSnippet),
          },
        ]
      : [],
  );
  const count = (band: Band): number =>
    [...bands.values()].filter((b) => b === band).length;
  return {
    weakExamples,
    result: {
      vacancyId: vacancy.spec.id,
      title: vacancy.spec.title,
      returned: ranked.length,
      ranked,
      bands: {
        strong: count('strong'),
        partial: count('partial'),
        weak: count('weak'),
      },
      metrics: rankMetrics(ranked, gains),
      weakInTop10: weakExamples.length,
      weakShareTop10:
        top.length === 0 ? null : weakExamples.length / top.length,
    },
  };
}

/** Highest-ranked first; ties by higher score, then vacancy and persona id. */
function worstFirst(a: G5Example, b: G5Example): number {
  return (
    a.rank - b.rank ||
    b.score - a.score ||
    a.vacancyId.localeCompare(b.vacancyId) ||
    a.personaId.localeCompare(b.personaId)
  );
}

function summarise(
  mode: MatchMode,
  evals: readonly VacancyEval[],
): { result: MatchModeResult; g5: G5Result } {
  const results = evals.map((e) => e.result);
  const slots = results.reduce((n, r) => n + Math.min(G5_TOP, r.returned), 0);
  const weak = results.reduce((n, r) => n + r.weakInTop10, 0);
  return {
    result: {
      mode,
      vacancies: results,
      metrics: meanRankMetrics(results.map((r) => r.metrics)),
      returned: mean(results.map((r) => r.returned)),
    },
    g5: {
      mode,
      meanWeakShare: mean(results.map((r) => r.weakShareTop10)),
      pooledWeakShare: slots === 0 ? null : weak / slots,
      worst: evals
        .flatMap((e) => e.weakExamples)
        .sort(worstFirst)
        .slice(0, G5_EXAMPLES),
    },
  };
}

export interface MatchesEvalInput {
  dataset: EvalDataset;
  /** The DB title and requirements by seeded vacancy id. */
  texts: ReadonlyMap<string, VacancyText>;
  floors?: MatchFloors;
}

/** Ranks the whole pool for every vacancy in both modes. Vacancies run in order. */
export async function evaluateMatches(
  deps: MatchDeps,
  { dataset, texts, floors = DEFAULT_MATCH_FLOORS }: MatchesEvalInput,
): Promise<MatchesEval> {
  const poolSize = dataset.personas.length;
  // A candidate outside the set keeps its own id (it counts as not relevant).
  const personaOf = (candidateId: string): string =>
    dataset.personaIdByCandidateId.get(candidateId) ?? candidateId;

  const evals: Record<MatchMode, VacancyEval[]> = {
    criteria: [],
    whole_text: [],
  };
  for (const vacancy of dataset.vacancies) {
    const text = texts.get(vacancy.id);
    if (!text) throw new Error(`No stored text for vacancy ${vacancy.spec.id}`);
    const criteriaRows = await rankCriteriaMode(
      deps,
      vacancy.criteria,
      floors.criteria,
      poolSize,
      personaOf,
    );
    evals.criteria.push(
      evaluateVacancy(vacancy, criteriaRows, dataset.groundTruth),
    );
    const wholeRows = await rankWholeTextMode(
      deps,
      text,
      floors.wholeText,
      poolSize,
      personaOf,
    );
    evals.whole_text.push(
      evaluateVacancy(vacancy, wholeRows, dataset.groundTruth),
    );
  }

  const criteria = summarise('criteria', evals.criteria);
  const wholeText = summarise('whole_text', evals.whole_text);
  return {
    results: { criteria: criteria.result, whole_text: wholeText.result },
    g5: { criteria: criteria.g5, whole_text: wholeText.g5 },
    floors,
    poolSize,
  };
}
