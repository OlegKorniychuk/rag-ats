import type { CvDocumentSummary } from './cv-documents.repository.js';

/**
 * Relational-query `with` clause that loads only the latest CV's metadata,
 * never `content` or `text`.
 */
export const latestCvSummaryWith = {
  cvDocuments: {
    columns: { id: true, filename: true, sizeBytes: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    limit: 1,
  },
} as const;

type CvRow = {
  id: string;
  filename: string;
  sizeBytes: number;
  createdAt: Date;
};

/**
 * Replaces the `cvDocuments` array of a loaded candidate with a non-null `cv`
 * summary. Throws if the candidate has no CV (every candidate must have one).
 */
export function withCv<T extends { id: string; cvDocuments: CvRow[] }>(
  row: T,
): Omit<T, 'cvDocuments'> & { cv: CvDocumentSummary } {
  const { cvDocuments, ...rest } = row;
  const latest = cvDocuments[0];
  if (!latest) {
    throw new Error(`Invariant violated: candidate ${row.id} has no CV`);
  }
  return {
    ...rest,
    cv: {
      id: latest.id,
      filename: latest.filename,
      sizeBytes: latest.sizeBytes,
      uploadedAt: latest.createdAt,
    },
  };
}
