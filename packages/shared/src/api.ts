// HTTP API contract shared between apps/api and any frontend. Types only.

// ---------- Enums ----------

export type VacancyStatus = 'open' | 'closed';
export type ApplicationStage =
  'applied' | 'screened' | 'interview' | 'rejected' | 'hired';

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

/** POST /apply/:token body */
export interface SubmitApplicationRequest {
  name: string;
  email: string;
  skills: string[];
  experience: string;
  projects: string[];
  summary: string;
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
  createdAt: IsoDateString;
}

/** GET /candidates, GET /candidates/:id */
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
  createdAt: IsoDateString;
}

/** GET /vacancies/:id/applications */
export type ApplicationWithCandidateResponse = ApplicationResponse & {
  candidate: CandidateResponse;
};
