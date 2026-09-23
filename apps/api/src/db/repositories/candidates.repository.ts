import { candidates } from '../schema.js';

export type Candidate = typeof candidates.$inferSelect;
export type NewCandidate = typeof candidates.$inferInsert;

export const CANDIDATES_REPOSITORY = Symbol('CANDIDATES_REPOSITORY');

export interface CandidatesRepository {
  create(data: NewCandidate): Promise<Candidate>;
  findByEmail(email: string): Promise<Candidate | null>;
  update(id: string, data: Partial<NewCandidate>): Promise<Candidate>;
}
