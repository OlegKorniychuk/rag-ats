import { applications } from '../schema.js';

export type Application = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;

export const APPLICATIONS_REPOSITORY = Symbol('APPLICATIONS_REPOSITORY');

export interface ApplicationsRepository {
  create(data: NewApplication): Promise<Application>;
  findByVacancyAndCandidate(
    vacancyId: string,
    candidateId: string,
  ): Promise<Application | null>;
}
