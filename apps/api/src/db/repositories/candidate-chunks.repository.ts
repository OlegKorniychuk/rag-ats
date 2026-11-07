export interface NewCandidateChunk {
  source: 'cv' | 'github';
  text: string;
  /** EMBEDDING_DIMENSIONS floats. */
  embedding: number[];
}

export interface ChunkHit {
  candidateId: string;
  source: 'cv' | 'github';
  text: string;
  /** Cosine similarity, `1 - cosine distance`. */
  similarity: number;
}

export const CANDIDATE_CHUNKS_REPOSITORY = Symbol(
  'CANDIDATE_CHUNKS_REPOSITORY',
);

export interface CandidateChunksRepository {
  /**
   * Replaces all of the candidate's chunks with `chunks` (`chunk_index` 0..n-1
   * in the given order), embedded by `model` from `cvDocumentId`. Delete and
   * insert are separate statements: the caller wraps them in a transaction.
   */
  replaceForCandidate(
    candidateId: string,
    cvDocumentId: string,
    chunks: NewCandidateChunk[],
    model: string,
  ): Promise<void>;

  /**
   * The `limit` chunks nearest to `embedding` across all candidates, most
   * similar first. Exact scan (no ANN index): the pool is small.
   */
  findNearest(embedding: number[], limit: number): Promise<ChunkHit[]>;
}
