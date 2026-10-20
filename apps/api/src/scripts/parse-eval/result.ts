import type { LlmUsage } from '../../llm/llm-client.js';
import type { ParsedProfile } from '../../llm/cv-profile.schema.js';
import type { CheckResult } from './checks.js';
import type { Pricing } from './cost.js';

/** `none` = the CV has no GitHub URL; `invalid_url` = URL was not a profile URL. */
export type GithubEvalStatus =
  'none' | 'invalid_url' | 'ok' | 'not_found' | 'unavailable';

export interface RunResult {
  run: number;
  /** Set when the run produced no profile (LLM parse failure or API error). */
  error: string | null;
  profile: ParsedProfile | null;
  usage: LlmUsage | null;
  costUsd: number;
  checks: CheckResult[];
  checksPassed: number;
  checksTotal: number;
}

export interface CvResult {
  id: string;
  file: string;
  layout: string;
  language: string;
  githubUrl: string | null;
  githubStatus: GithubEvalStatus;
  /** Length of the extracted PDF text; null when extraction failed. */
  textLength: number | null;
  /** Set when the CV could not be processed at all (e.g. unreadable PDF). */
  error: string | null;
  runs: RunResult[];
}

export interface EvalResult {
  label: string;
  model: string;
  date: string;
  runsPerCv: number;
  pricing: Pricing;
  cvs: CvResult[];
}
