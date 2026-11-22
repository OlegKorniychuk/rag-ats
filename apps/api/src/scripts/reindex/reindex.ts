/**
 * Rebuilds the chunks of every parsed candidate with another CV chunk size
 * and/or embedding model (the RAG parameter experiments). Pure over its deps:
 * the CLI wires them to an experiment copy of the seeded database.
 */
import type { NewCandidateChunk } from '../../db/repositories/candidate-chunks.repository.js';
import type { CandidateEmbedState } from '../../db/repositories/candidates.repository.js';
import type { GithubSnapshot } from '../../github/github-snapshot.js';
import { chunkCandidate } from '../../rag/chunking.js';

export interface ReindexDeps {
  candidateIds(): Promise<string[]>;
  embedState(candidateId: string): Promise<CandidateEmbedState | null>;
  cvText(cvDocumentId: string): Promise<string | null>;
  snapshot(candidateId: string): Promise<GithubSnapshot | null>;
  embed(texts: string[]): Promise<number[][]>;
  /** Replaces the candidate's chunks (in one transaction). */
  save(
    candidateId: string,
    cvDocumentId: string,
    chunks: NewCandidateChunk[],
  ): Promise<void>;
  /** Metered spend so far, in USD. */
  spentUsd(): number;
}

export interface ReindexOptions {
  cvMaxChars: number;
  dryRun: boolean;
  maxUsd: number;
  /** Embedding price of the configured model, USD per 1M tokens. */
  pricePerMillion: number;
}

export interface ReindexSummary {
  /** Candidates re-chunked (or, in a dry run, that would be). */
  candidates: number;
  /** Candidates without a parsed CV. */
  skipped: number;
  chunks: { cv: number; github: number };
  meanCvChunkChars: number;
  maxCvChunkChars: number;
  totalChars: number;
  /** chars / 4, the usual English estimate. */
  estimatedTokens: number;
  estimatedUsd: number;
  stopped: 'budget' | null;
}

const estimateTokens = (chars: number): number => Math.ceil(chars / 4);

export async function reindexAll(
  deps: ReindexDeps,
  options: ReindexOptions,
): Promise<ReindexSummary> {
  const summary: ReindexSummary = {
    candidates: 0,
    skipped: 0,
    chunks: { cv: 0, github: 0 },
    meanCvChunkChars: 0,
    maxCvChunkChars: 0,
    totalChars: 0,
    estimatedTokens: 0,
    estimatedUsd: 0,
    stopped: null,
  };
  let cvChars = 0;

  for (const candidateId of await deps.candidateIds()) {
    const state = await deps.embedState(candidateId);
    const cvDocumentId = state?.parsedCvDocumentId ?? null;
    if (state?.parseStatus !== 'parsed' || cvDocumentId === null) {
      summary.skipped += 1;
      continue;
    }
    const text = await deps.cvText(cvDocumentId);
    if (text === null) throw new Error(`CV document ${cvDocumentId} not found`);
    const chunks = chunkCandidate(text, await deps.snapshot(candidateId), {
      cvMaxChars: options.cvMaxChars,
    });
    const chars = chunks.reduce((n, c) => n + c.text.length, 0);
    const estimateUsd =
      (estimateTokens(chars) * options.pricePerMillion) / 1_000_000;

    if (!options.dryRun) {
      if (deps.spentUsd() + estimateUsd > options.maxUsd) {
        summary.stopped = 'budget';
        break;
      }
      const vectors =
        chunks.length > 0 ? await deps.embed(chunks.map((c) => c.text)) : [];
      await deps.save(
        candidateId,
        cvDocumentId,
        chunks.map((chunk, i) => ({ ...chunk, embedding: vectors[i] })),
      );
    }

    summary.candidates += 1;
    summary.totalChars += chars;
    for (const chunk of chunks) {
      summary.chunks[chunk.source] += 1;
      if (chunk.source === 'cv') {
        cvChars += chunk.text.length;
        summary.maxCvChunkChars = Math.max(
          summary.maxCvChunkChars,
          chunk.text.length,
        );
      }
    }
  }

  summary.meanCvChunkChars =
    summary.chunks.cv > 0 ? Math.round(cvChars / summary.chunks.cv) : 0;
  summary.estimatedTokens = estimateTokens(summary.totalChars);
  summary.estimatedUsd =
    (summary.estimatedTokens * options.pricePerMillion) / 1_000_000;
  return summary;
}
