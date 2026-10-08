import { cvDocuments } from '../schema.js';

export type NewCvDocument = typeof cvDocuments.$inferInsert;

/** CV metadata; deliberately excludes `content` and `text`. */
export type CvDocumentSummary = {
  id: string;
  filename: string;
  sizeBytes: number;
  uploadedAt: Date;
};

export const CV_DOCUMENTS_REPOSITORY = Symbol('CV_DOCUMENTS_REPOSITORY');

export interface CvDocumentsRepository {
  create(data: NewCvDocument): Promise<CvDocumentSummary>;
  findLatestContentByCandidate(
    candidateId: string,
  ): Promise<{ filename: string; content: Buffer } | null>;
}
