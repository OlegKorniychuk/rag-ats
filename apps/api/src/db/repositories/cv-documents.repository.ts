import { cvDocuments } from '../schema.js';

export type NewCvDocument = typeof cvDocuments.$inferInsert;

/** CV metadata; deliberately excludes `content` and `text`. */
export type CvDocumentSummary = {
  id: string;
  filename: string;
  sizeBytes: number;
  uploadedAt: Date;
};

/** Identity of a candidate's newest CV, without its bytes. */
export type LatestCvIdentity = {
  id: string;
  /** Hex SHA-256 of the content; null only for rows the backfill missed. */
  contentSha256: string | null;
};

export const CV_DOCUMENTS_REPOSITORY = Symbol('CV_DOCUMENTS_REPOSITORY');

export interface CvDocumentsRepository {
  create(data: NewCvDocument): Promise<CvDocumentSummary>;
  findLatestContentByCandidate(
    candidateId: string,
  ): Promise<{ filename: string; content: Buffer } | null>;
  /** The newest CV's id and content hash, or null when there is none. */
  findLatestIdentityByCandidate(
    candidateId: string,
  ): Promise<LatestCvIdentity | null>;
  /** The extracted text of one CV, or null when it doesn't exist. */
  findTextById(id: string): Promise<string | null>;
}
