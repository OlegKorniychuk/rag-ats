import type { GithubSummary, ParseStatus } from '@rag-ats/shared';
import { getTableColumns } from 'drizzle-orm';
import { candidates } from '../schema.js';
import type { GithubSnapshot } from '../../github/github-snapshot.js';
import type { CvDocumentSummary } from './cv-documents.repository.js';

/**
 * Internal columns, never part of the API shape: parse bookkeeping and the raw
 * GitHub snapshot (reads expose it only as a mapped `github` summary).
 */
const {
  parsedCvDocumentId,
  parsedAt,
  githubSnapshot,
  ...publicCandidateColumnMap
} = getTableColumns(candidates);
void parsedCvDocumentId;
void parsedAt;
void githubSnapshot;

/** Column selection for `insert/update ... returning()` in the public shape. */
export const publicCandidateColumns = publicCandidateColumnMap;

/**
 * Relational-query `columns` clause that drops the internal parse columns.
 * `githubSnapshot` is deliberately kept: `withGithub` consumes it and replaces
 * it with the `github` summary, so the raw jsonb never leaves the repository.
 */
export const publicCandidateColumnsWith = {
  parsedCvDocumentId: false,
  parsedAt: false,
} as const;

export type CandidateRow = Omit<
  typeof candidates.$inferSelect,
  'parsedCvDocumentId' | 'parsedAt' | 'githubSnapshot'
>;
export type NewCandidate = typeof candidates.$inferInsert;
/**
 * A candidate as read back: always carries its latest CV summary and the
 * (stripped) GitHub summary, null when not fetched.
 */
export type Candidate = CandidateRow & {
  cv: CvDocumentSummary;
  github: GithubSummary | null;
};

/** What the parse worker needs to decide whether a job is still relevant. */
export interface CandidateParseState {
  id: string;
  parseStatus: ParseStatus;
  /** The CV the current profile was parsed from, if any. */
  parsedCvDocumentId: string | null;
  /** The newest CV by `created_at`. */
  latestCvDocumentId: string;
  /** The candidate's self-reported GitHub URL, unvalidated. */
  githubUrl: string | null;
}

export interface ParsedProfile {
  skills: string[];
  experience: string;
  projects: string[];
  summary: string;
}

export const CANDIDATES_REPOSITORY = Symbol('CANDIDATES_REPOSITORY');

export interface CandidatesRepository {
  /** A freshly created candidate has no CV row yet and is `pending`. */
  create(data: NewCandidate): Promise<CandidateRow>;
  findAll(): Promise<Candidate[]>;
  findById(id: string): Promise<Candidate | null>;
  findByEmail(email: string): Promise<Candidate | null>;
  update(id: string, data: Partial<NewCandidate>): Promise<CandidateRow>;
  /** Sets the status and `parseError` (null unless `error` is given). */
  setParseStatus(
    id: string,
    status: ParseStatus,
    error?: string | null,
  ): Promise<void>;
  /**
   * Atomically moves `pending`/`failed`/`parsing` to `parsing` (clearing the
   * error). Returns false, changing nothing, when the candidate is already
   * `parsed` (or missing): a newer job finished first and this one must stop.
   * `parsing` is allowed so a job recovered after a crash can re-run.
   */
  markParsing(id: string): Promise<boolean>;
  /**
   * Writes the profile and the GitHub snapshot (null clears it) and marks the
   * candidate `parsed` from `cvDocumentId`, in one update.
   */
  saveParsedProfile(
    id: string,
    cvDocumentId: string,
    profile: ParsedProfile,
    githubSnapshot: GithubSnapshot | null,
  ): Promise<void>;
  findParseState(id: string): Promise<CandidateParseState | null>;
  /** The raw (internal) GitHub snapshot saved with the profile, if any. */
  findGithubSnapshot(id: string): Promise<GithubSnapshot | null>;
  /** Candidates still `pending`/`parsing`, with their latest CV id. */
  findParseBacklog(): Promise<
    Array<{ candidateId: string; cvDocumentId: string }>
  >;
}
