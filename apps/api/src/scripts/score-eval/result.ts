import type { LlmUsage } from '../../llm/llm-client.js';
import type { VacancyCriterion } from '../../llm/criteria-extractor.js';
import type { GithubEvalStatus } from '../parse-eval/result.js';
import type { Pricing } from '../parse-eval/cost.js';
import type { Band } from './vacancies.js';
import type {
  BandResult,
  CoverageResult,
  FillerSuspect,
  GroundedCheck,
} from './checks.js';

export interface QuoteRecord {
  source: 'cv' | 'github';
  text: string;
}

export interface CriterionRecord {
  id: string;
  text: string;
  importance: 'must' | 'nice';
  score: number;
  reasoning: string;
  quotes: QuoteRecord[];
}

export interface PairResult {
  vacancyId: string;
  cvId: string;
  run: number;
  status: 'scored' | 'failed';
  /** Error class and message when `status` is `failed`. */
  error: string | null;
  overall: number | null;
  rationale: string;
  criteria: CriterionRecord[];
  /** Model calls made for this pair (2 means the scorer retried). */
  attempts: number;
  usage: LlmUsage | null;
  costUsd: number;
  expected: Band | null;
  band: Band | null;
  bandResult: BandResult;
  /** Null for failed pairs: there is nothing to verify. */
  grounded: GroundedCheck | null;
  fillerSuspects: FillerSuspect[];
}

/** One criteria extraction (per vacancy per run). */
export interface ExtractionResult {
  vacancyId: string;
  run: number;
  error: string | null;
  criteria: VacancyCriterion[];
  usage: LlmUsage | null;
  costUsd: number;
  /** Null when the vacancy has no `mustCoverTerms`. */
  coverage: CoverageResult | null;
}

export interface CvInfo {
  id: string;
  file: string;
  githubUrl: string | null;
  githubStatus: GithubEvalStatus;
  /** Null when extraction failed. */
  textLength: number | null;
  error: string | null;
}

export interface VacancyInfo {
  id: string;
  title: string;
  requirementCount: number;
}

export interface EvalResult {
  label: string;
  model: string;
  date: string;
  runs: number;
  pricing: Pricing;
  cvs: CvInfo[];
  vacancies: VacancyInfo[];
  extractions: ExtractionResult[];
  pairs: PairResult[];
}
