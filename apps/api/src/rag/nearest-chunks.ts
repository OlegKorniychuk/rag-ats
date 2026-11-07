/** Chunks retrieved per criterion in `rag` scoring mode (production and eval). */
export const RAG_CHUNKS_PER_CRITERION = 3;

export interface EmbeddedChunk {
  source: 'cv' | 'github';
  text: string;
  embedding: number[];
}

export interface NearestChunk {
  source: 'cv' | 'github';
  text: string;
  similarity: number;
}

/** Exact cosine similarity; 0 when either vector is all zeros. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * The `k` chunks most similar to `queryVector`, best first (ties keep input
 * order). In-memory twin of `CandidateChunksRepository.findNearest` for one
 * candidate: same exact cosine, so both retrieve the same chunks.
 */
export function nearestChunks(
  queryVector: number[],
  chunks: EmbeddedChunk[],
  k: number,
): NearestChunk[] {
  return chunks
    .map((chunk, index) => ({
      index,
      source: chunk.source,
      text: chunk.text,
      similarity: cosineSimilarity(queryVector, chunk.embedding),
    }))
    .sort((a, b) => b.similarity - a.similarity || a.index - b.index)
    .slice(0, Math.max(0, k))
    .map(({ source, text, similarity }) => ({ source, text, similarity }));
}
