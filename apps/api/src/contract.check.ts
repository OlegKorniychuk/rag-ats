// Guards against drift between Drizzle rows/DTOs and @rag-ats/shared's API types; type-only, no runtime effect.
import type {
  ApplicationResponse,
  ApplicationStage,
  ApplicationWithCandidateResponse,
  AuthUserResponse,
  CandidateResponse,
  PublicVacancyResponse,
  VacancyResponse,
  VacancyStatus,
} from '@rag-ats/shared';
import type { PublicVacancy } from './apply/apply.service.js';
import type { AuthUser } from './auth/auth-user.js';
import type {
  Application,
  ApplicationWithCandidate,
} from './db/repositories/applications.repository.js';
import type { Candidate } from './db/repositories/candidates.repository.js';
import type { Vacancy } from './db/repositories/vacancies.repository.js';
import type { applicationStageEnum, vacancyStatusEnum } from './db/schema.js';

type Jsonify<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Jsonify<U>[]
    : T extends object
      ? { [K in keyof T]: Jsonify<T[K]> }
      : T;

// Flattens an intersection type into a single object type so Equal doesn't
// spuriously fail on `A & { ... }` vs an equivalent plain interface.
type Simplify<T> = { [K in keyof T]: T[K] } & {};

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

type Assert<T extends true> = T;

export type CheckVacancy = Assert<
  Equal<Simplify<Jsonify<Vacancy>>, Simplify<VacancyResponse>>
>;
export type CheckApplication = Assert<
  Equal<Simplify<Jsonify<Application>>, Simplify<ApplicationResponse>>
>;
export type CheckCandidate = Assert<
  Equal<Simplify<Jsonify<Candidate>>, Simplify<CandidateResponse>>
>;
export type CheckApplicationWithCandidate = Assert<
  Equal<
    Simplify<Jsonify<ApplicationWithCandidate>>,
    Simplify<ApplicationWithCandidateResponse>
  >
>;
export type CheckPublicVacancy = Assert<
  Equal<Simplify<PublicVacancy>, Simplify<PublicVacancyResponse>>
>;
export type CheckAuthUser = Assert<
  Equal<Simplify<AuthUser>, Simplify<AuthUserResponse>>
>;
export type CheckApplicationStage = Assert<
  Equal<(typeof applicationStageEnum.enumValues)[number], ApplicationStage>
>;
export type CheckVacancyStatus = Assert<
  Equal<(typeof vacancyStatusEnum.enumValues)[number], VacancyStatus>
>;
