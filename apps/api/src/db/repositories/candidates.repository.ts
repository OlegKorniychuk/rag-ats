import { candidates } from '../schema.js';
import type { CvDocumentSummary } from './cv-documents.repository.js';

export type CandidateRow = typeof candidates.$inferSelect;
export type NewCandidate = typeof candidates.$inferInsert;
/** A candidate as read back: always carries its latest CV summary. */
export type Candidate = CandidateRow & { cv: CvDocumentSummary };

export const CANDIDATES_REPOSITORY = Symbol('CANDIDATES_REPOSITORY');

export interface CandidatesRepository {
  /** A freshly created candidate has no CV row yet. */
  create(data: NewCandidate): Promise<CandidateRow>;
  findAll(): Promise<Candidate[]>;
  findById(id: string): Promise<Candidate | null>;
  findByEmail(email: string): Promise<Candidate | null>;
  update(id: string, data: Partial<NewCandidate>): Promise<CandidateRow>;
}
