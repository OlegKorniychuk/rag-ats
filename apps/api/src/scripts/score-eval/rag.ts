/**
 * Pure helpers for `score-eval --mode rag`: in-memory chunk ids, per-criterion
 * retrieval, evidence coverage and embedding cost. No I/O, no LLM.
 */
import type { RetrievedChunk, ScoringMode } from '@rag-ats/shared';
import type { CriterionEvidence } from '../../llm/prompts/application-score-rag.prompt.js';
import type { TextChunk } from '../../rag/chunking.js';
import { nearestChunks, type EmbeddedChunk } from '../../rag/nearest-chunks.js';

/** Nearest chunks shown per criterion (production's `RAG_CHUNKS_PER_CRITERION`). */
export const DEFAULT_RAG_K = 3;
/** USD per 1M tokens for text-embedding-3-small (third-party listed price). */
export const DEFAULT_EMBEDDING_PRICE = 0.02;
/** Characters of a chunk shown in the report and review previews. */
export const PREVIEW_CHARS = 60;

export const SCORING_MODES: readonly ScoringMode[] = ['full_text', 'rag'];

/** A bad `--mode` (the script turns it into a usage error). */
export class ModeError extends Error {}

/** `--mode`; defaults to `full_text`, anything but the two modes is a usage error. */
export function parseMode(raw: string | undefined): ScoringMode {
  if (raw === undefined) return 'full_text';
  if ((SCORING_MODES as readonly string[]).includes(raw)) {
    return raw as ScoringMode;
  }
  throw new ModeError(
    `--mode must be one of: ${SCORING_MODES.join(', ')} (got "${raw}")`,
  );
}

/** A candidate chunk with its in-memory id (`ch1`, `ch2`, … in chunking order). */
export interface EvalChunk extends EmbeddedChunk {
  id: string;
}

export function buildEvalChunks(
  textChunks: TextChunk[],
  vectors: number[][],
): EvalChunk[] {
  if (textChunks.length !== vectors.length) {
    throw new Error(
      `expected ${textChunks.length} embedding(s), got ${vectors.length}`,
    );
  }
  return textChunks.map((chunk, index) => ({
    id: `ch${index + 1}`,
    source: chunk.source,
    text: chunk.text,
    embedding: vectors[index],
  }));
}

/** A retrieved chunk as stored in the JSON result. */
export interface RetrievedRecord {
  chunkId: string;
  source: 'cv' | 'github';
  similarity: number;
  text: string;
}

export interface CriterionRetrieval {
  criterionId: string;
  chunks: RetrievedRecord[];
}

/**
 * The `k` nearest chunks per criterion (`nearestChunks`, same exact cosine as
 * production). Each result is mapped back to its chunk id; two chunks with
 * identical text keep distinct ids.
 */
export function retrieveForCriteria(
  criteria: { id: string }[],
  vectors: number[][],
  chunks: EvalChunk[],
  k: number,
): CriterionRetrieval[] {
  if (criteria.length !== vectors.length) {
    throw new Error(
      `expected ${criteria.length} criterion embedding(s), got ${vectors.length}`,
    );
  }
  return criteria.map((criterion, index) => {
    const used = new Set<string>();
    const found = nearestChunks(vectors[index], chunks, k).map((hit) => {
      const chunk = chunks.find(
        (c) =>
          !used.has(c.id) && c.source === hit.source && c.text === hit.text,
      )!;
      used.add(chunk.id);
      return {
        chunkId: chunk.id,
        source: hit.source,
        similarity: hit.similarity,
        text: hit.text,
      };
    });
    return { criterionId: criterion.id, chunks: found };
  });
}

/** Retrieval in the shape `ApplicationScorer.scoreRag` takes. */
export function toEvidence(
  retrieval: CriterionRetrieval[],
): CriterionEvidence[] {
  return retrieval.map((r) => ({
    criterionId: r.criterionId,
    chunks: r.chunks.map((c): RetrievedChunk => ({
      source: c.source,
      text: c.text,
      similarity: c.similarity,
    })),
  }));
}

/** How much of a candidate's chunks the model was shown for one pair. */
export interface EvidenceCoverage {
  /** Distinct chunks retrieved for any criterion. */
  shown: number;
  /** All chunks of the candidate. */
  total: number;
  /** `shown / total`; null when the candidate has no chunks. */
  ratio: number | null;
}

export function evidenceCoverage(
  retrieval: CriterionRetrieval[],
  totalChunks: number,
): EvidenceCoverage {
  const ids = new Set(retrieval.flatMap((r) => r.chunks.map((c) => c.chunkId)));
  return {
    shown: ids.size,
    total: totalChunks,
    ratio: totalChunks === 0 ? null : ids.size / totalChunks,
  };
}

export interface CoverageStats {
  pairs: number;
  mean: number;
  min: number;
  max: number;
}

/** Mean / min / max coverage ratio over the pairs that have one; null if none. */
export function coverageStats(
  coverages: (EvidenceCoverage | null | undefined)[],
): CoverageStats | null {
  const ratios = coverages
    .map((c) => c?.ratio)
    .filter((r): r is number => typeof r === 'number');
  if (ratios.length === 0) return null;
  return {
    pairs: ratios.length,
    mean: ratios.reduce((a, b) => a + b, 0) / ratios.length,
    min: Math.min(...ratios),
    max: Math.max(...ratios),
  };
}

/** USD for `tokens` embedding tokens at `pricePerMillion`. */
export function embeddingCostUsd(
  tokens: number,
  pricePerMillion: number,
): number {
  return (tokens * pricePerMillion) / 1_000_000;
}

/** Rough token count (4 characters per token) for dry-run estimates. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface EmbeddingEstimate {
  chunkTokens: number;
  criteriaTokens: number;
  totalTokens: number;
  costUsd: number;
}

/**
 * Dry-run estimate of the embedding bill: every CV's chunks once, and each
 * vacancy's requirement text (a stand-in for its criteria, which a dry run does
 * not extract) once per run.
 */
export function estimateEmbedding(params: {
  chunkTexts: string[][];
  requirementTexts: string[];
  runs: number;
  pricePerMillion: number;
}): EmbeddingEstimate {
  const chunkTokens = params.chunkTexts
    .flat()
    .reduce((sum, text) => sum + estimateTokens(text), 0);
  const criteriaTokens =
    params.requirementTexts.reduce((sum, t) => sum + estimateTokens(t), 0) *
    params.runs;
  const totalTokens = chunkTokens + criteriaTokens;
  return {
    chunkTokens,
    criteriaTokens,
    totalTokens,
    costUsd: embeddingCostUsd(totalTokens, params.pricePerMillion),
  };
}

/** `ch2 [cv] 0.61 "first words…"` */
export function previewChunk(chunk: RetrievedRecord): string {
  const flat = chunk.text.replace(/\s+/g, ' ').trim();
  const text =
    flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS)}...` : flat;
  return `${chunk.chunkId} [${chunk.source}] ${chunk.similarity.toFixed(2)} "${text}"`;
}
