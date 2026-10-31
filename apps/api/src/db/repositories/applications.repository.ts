import type { ApplicationScore, VacancyStatus } from '@rag-ats/shared';
import { applications } from '../schema.js';
import type { Candidate } from './candidates.repository.js';
import type { Vacancy } from './vacancies.repository.js';

export type Application = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;
export type ApplicationWithCandidate = Application & {
  candidate: Candidate;
  score: ApplicationScore;
};
export type CandidateApplication = Pick<
  Application,
  'id' | 'vacancyId' | 'stage' | 'source' | 'createdAt'
> & {
  vacancyTitle: string;
  vacancyStatus: VacancyStatus;
  score: ApplicationScore;
};
export type ApplicationWithVacancy = Application & { vacancy: Vacancy };

export const APPLICATIONS_REPOSITORY = Symbol('APPLICATIONS_REPOSITORY');

export interface ApplicationsRepository {
  create(data: NewApplication): Promise<Application>;
  findByVacancyAndCandidate(
    vacancyId: string,
    candidateId: string,
  ): Promise<Application | null>;
  findByVacancyIdWithCandidate(
    vacancyId: string,
  ): Promise<ApplicationWithCandidate[]>;
  findByIdWithCandidate(id: string): Promise<ApplicationWithCandidate | null>;
  /** The candidate's applications on this recruiter's vacancies only, newest first. */
  findByCandidateForRecruiter(
    candidateId: string,
    recruiterId: string,
  ): Promise<CandidateApplication[]>;
  findByIdWithVacancy(id: string): Promise<ApplicationWithVacancy | null>;
  updateStage(id: string, stage: Application['stage']): Promise<Application>;
}
