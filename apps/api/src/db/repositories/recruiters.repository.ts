import { recruiters } from '../schema.js';

export type Recruiter = typeof recruiters.$inferSelect;
export type NewRecruiter = typeof recruiters.$inferInsert;

export const RECRUITERS_REPOSITORY = Symbol('RECRUITERS_REPOSITORY');

export interface RecruitersRepository {
  create(data: NewRecruiter): Promise<Recruiter>;
  findByEmail(email: string): Promise<Recruiter | null>;
  findById(id: string): Promise<Recruiter | null>;
}
