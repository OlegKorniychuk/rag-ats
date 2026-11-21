import type { RetrievedChunk } from '@rag-ats/shared';
import type { CandidateChunksRepository } from '../db/repositories/candidate-chunks.repository.js';
import type { CriterionEvidence } from '../llm/prompts/application-score-rag.prompt.js';
import { RAG_CHUNKS_PER_CRITERION } from './nearest-chunks.js';

/**
 * `rag` scoring mode's retrieval, shared by the score worker and the eval: the
 * criteria are embedded in one call, then each criterion gets the candidate's
 * own nearest chunks (best first, similarity rounded to 3 decimals). The
 * result keeps the order of `criteria`.
 */
export async function retrieveCriterionEvidence(
  llm: { embed(texts: string[]): Promise<{ vectors: number[][] }> },
  chunks: Pick<CandidateChunksRepository, 'findNearest'>,
  candidateId: string,
  criteria: { id: string; text: string }[],
): Promise<CriterionEvidence[]> {
  const { vectors } = await llm.embed(criteria.map((c) => c.text));
  const evidence: CriterionEvidence[] = [];
  for (const [index, criterion] of criteria.entries()) {
    const hits = await chunks.findNearest(
      vectors[index],
      RAG_CHUNKS_PER_CRITERION,
      { candidateId },
    );
    const retrieved: RetrievedChunk[] = hits.map((hit) => ({
      source: hit.source,
      text: hit.text,
      similarity: Math.round(hit.similarity * 1000) / 1000,
    }));
    evidence.push({ criterionId: criterion.id, chunks: retrieved });
  }
  return evidence;
}
