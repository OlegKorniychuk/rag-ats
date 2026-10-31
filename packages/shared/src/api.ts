// HTTP API contract shared between apps/api and any frontend. Types only.

// ---------- Enums ----------

export type VacancyStatus = 'open' | 'closed';
export type ApplicationStage =
  'applied' | 'screened' | 'interview' | 'rejected' | 'hired';
/** How an application came to exist: the candidate applied, or a recruiter added them from the pool. */
export type ApplicationSource = 'applied' | 'added';
export type ParseStatus = 'pending' | 'parsing' | 'parsed' | 'failed';
/** Progress of the background scoring of one application. */
export type ScoreStatus = 'pending' | 'scoring' | 'scored' | 'failed';
/** How much a vacancy criterion weighs: `must` counts double `nice` in the overall score. */
export type CriterionImportance = 'must' | 'nice';
/** Outcome of the last GitHub fetch for a candidate. */
export type GithubStatus = 'ok' | 'not_found' | 'unavailable';

/** Dates are serialized as ISO 8601 strings over JSON. */
export type IsoDateString = string;

// ---------- Requests ----------

/** POST /auth/register body */
export interface RegisterRequest {
  email: string;
  password: string;
}

/** POST /auth/login body */
export interface LoginRequest {
  email: string;
  password: string;
}

/** POST /vacancies body */
export interface CreateVacancyRequest {
  title: string;
  requirements: string;
}

/** PATCH /vacancies/:id body */
export interface UpdateVacancyRequest {
  title?: string;
  requirements?: string;
  status?: VacancyStatus;
}

/** PATCH /applications/:id body */
export interface UpdateApplicationRequest {
  stage: ApplicationStage;
}

/** POST /vacancies/:id/applications body: adds an existing pool candidate to the vacancy. */
export interface AddApplicationRequest {
  candidateId: string;
}

/**
 * POST /apply/:token body: the text fields of a `multipart/form-data` request.
 * The PDF CV goes in the `cv` file part.
 */
export interface SubmitApplicationRequest {
  name: string;
  email: string;
  githubUrl?: string;
  portfolioUrl?: string;
}

// ---------- Responses ----------

/** POST /auth/login, POST /auth/logout, POST /apply/:token */
export interface SuccessResponse {
  success: true;
}

/** POST /auth/register response */
export interface RegisterResponse {
  id: string;
  email: string;
}

/** GET /auth/me */
export interface AuthUserResponse {
  id: string;
  email: string;
}

/** GET /vacancies, GET /vacancies/:id, POST /vacancies, PATCH /vacancies/:id */
export interface VacancyResponse {
  id: string;
  recruiterId: string;
  title: string;
  requirements: string;
  applyToken: string;
  status: VacancyStatus;
  createdAt: IsoDateString;
}

/** GET /apply/:token */
export interface PublicVacancyResponse {
  title: string;
  requirements: string;
  status: VacancyStatus;
}

/** PATCH /applications/:id */
export interface ApplicationResponse {
  id: string;
  vacancyId: string;
  candidateId: string;
  stage: ApplicationStage;
  source: ApplicationSource;
  createdAt: IsoDateString;
}

/** Metadata of a candidate's latest CV (the PDF bytes are never inlined) */
export interface CvDocumentSummary {
  id: string;
  filename: string;
  sizeBytes: number;
  uploadedAt: IsoDateString;
}

/** A public GitHub repository, as shown on the candidate page. */
export interface GithubRepoSummary {
  name: string;
  url: string;
  description: string | null;
  language: string | null;
  stars: number;
  topics: string[];
  pushedAt: IsoDateString;
}

/**
 * Public GitHub data fetched when the candidate's CV was last parsed. When
 * `status` is not `ok`, `repos` and `languages` are empty.
 */
export interface GithubSummary {
  username: string;
  profileUrl: string;
  status: GithubStatus;
  fetchedAt: IsoDateString;
  repos: GithubRepoSummary[];
  /** Primary-language counts across the candidate's owned, non-fork repos. */
  languages: { name: string; repoCount: number }[];
}

/**
 * GET /candidates, GET /candidates/:id
 *
 * Also returned (202) by POST /candidates/:id/reparse, which has no request
 * body: it re-queues parsing of the latest CV and is only allowed while
 * `parseStatus` is `parsed` or `failed`.
 */
export interface CandidateResponse {
  id: string;
  name: string;
  email: string;
  githubUrl: string | null;
  portfolioUrl: string | null;
  skills: string[];
  experience: string;
  projects: string[];
  summary: string;
  cv: CvDocumentSummary;
  /** Null when there is no (parseable) GitHub URL or before the first fetch. */
  github: GithubSummary | null;
  /** Progress of the async LLM parse that fills the profile fields from the CV. */
  parseStatus: ParseStatus;
  /** Short, safe reason when `parseStatus` is `failed`; otherwise null. */
  parseError: string | null;
  createdAt: IsoDateString;
}

/**
 * One requirement extracted from a vacancy. Internal storage shape (not part of
 * VacancyResponse); `id` is stable within a vacancy (`c1`..`cN`).
 */
export interface VacancyCriterion {
  id: string;
  text: string;
  importance: CriterionImportance;
}

/** A verbatim snippet backing a criterion score, checked against its source. */
export interface ScoreQuote {
  source: 'cv' | 'github';
  text: string;
}

/** The score of one vacancy criterion, with its evidence. */
export interface CriterionScore {
  criterionId: string;
  criterion: string;
  importance: CriterionImportance;
  /** 0-100. */
  score: number;
  reasoning: string;
  quotes: ScoreQuote[];
}

/** A completed, grounded score of an application. */
export interface ScoreResult {
  /** 0-100, the importance-weighted mean of the criteria scores. */
  overall: number;
  rationale: string;
  criteria: CriterionScore[];
  /** The CV the score was computed from. */
  cvDocumentId: string;
  model: string;
  mode: 'full_text';
  scoredAt: IsoDateString;
}

/**
 * The background fit score of an application. `result` keeps the last good
 * score while a rescore is pending; `stale` is true when that result was not
 * computed from the candidate's current CV or the vacancy's current criteria.
 */
export interface ApplicationScore {
  status: ScoreStatus;
  /** Short, safe reason when `status` is `failed`; otherwise null. */
  error: string | null;
  /** True while the candidate's CV is not yet `parsed`. */
  waitingForParse: boolean;
  stale: boolean;
  result: ScoreResult | null;
}

/** POST /applications/:id/rescore -> 202, the freshly reset (pending) score. */
export type RescoreResponse = ApplicationScore;

/**
 * GET /vacancies/:id/applications
 *
 * Also returned (201) by POST /vacancies/:id/applications.
 */
export type ApplicationWithCandidateResponse = ApplicationResponse & {
  candidate: CandidateResponse;
  score: ApplicationScore;
};

/**
 * GET /candidates/:id/applications: the candidate's applications on the
 * current recruiter's vacancies only, newest first.
 */
export interface CandidateApplicationResponse {
  id: string;
  vacancyId: string;
  vacancyTitle: string;
  vacancyStatus: VacancyStatus;
  stage: ApplicationStage;
  source: ApplicationSource;
  createdAt: IsoDateString;
  score: ApplicationScore;
}
