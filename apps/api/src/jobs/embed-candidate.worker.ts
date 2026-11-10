import { Inject, Injectable, Logger } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { ClsService } from 'nestjs-cls';
import {
  CANDIDATE_CHUNKS_REPOSITORY,
  type CandidateChunksRepository,
  type NewCandidateChunk,
} from '../db/repositories/candidate-chunks.repository.js';
import {
  CANDIDATES_REPOSITORY,
  type CandidatesRepository,
} from '../db/repositories/candidates.repository.js';
import {
  CV_DOCUMENTS_REPOSITORY,
  type CvDocumentsRepository,
} from '../db/repositories/cv-documents.repository.js';
import {
  SCORES_REPOSITORY,
  type ScoresRepository,
} from '../db/repositories/scores.repository.js';
import { LlmClient } from '../llm/llm-client.js';
import { chunkCandidate } from '../rag/chunking.js';
import type { EmbedCandidateJob } from './jobs.constants.js';
import { JobsService } from './jobs.service.js';

@Injectable()
export class EmbedCandidateWorker {
  private readonly logger = new Logger(EmbedCandidateWorker.name);

  constructor(
    @Inject(CANDIDATES_REPOSITORY)
    private readonly candidates: CandidatesRepository,
    @Inject(CV_DOCUMENTS_REPOSITORY)
    private readonly cvDocuments: CvDocumentsRepository,
    @Inject(CANDIDATE_CHUNKS_REPOSITORY)
    private readonly chunks: CandidateChunksRepository,
    @Inject(SCORES_REPOSITORY)
    private readonly scores: ScoresRepository,
    private readonly llm: LlmClient,
    private readonly jobs: JobsService,
    private readonly cls: ClsService,
  ) {}

  /** Own CLS context per job (see ParseCandidateWorker.handle). */
  handle(job: EmbedCandidateJob): Promise<void> {
    return this.cls.run(() => this.process(job));
  }

  /**
   * Unlike parse and score, failures are not recorded on a row (nothing in the
   * UI shows embed status): they are logged and rethrown so pg-boss retries
   * the job, and the startup sweep picks up whatever is still not embedded.
   */
  private async process({
    candidateId,
    cvDocumentId,
  }: EmbedCandidateJob): Promise<void> {
    try {
      const state = await this.candidates.findEmbedState(candidateId);
      // Skip: not parsed yet (the parse job enqueues embedding when done),
      // stale (a newer CV was parsed, its own job owns the work), or a
      // duplicate (these chunks are already in place).
      if (
        state?.parseStatus !== 'parsed' ||
        state.parsedCvDocumentId !== cvDocumentId ||
        state.embeddedCvDocumentId === cvDocumentId
      ) {
        return;
      }

      const text = await this.cvDocuments.findTextById(cvDocumentId);
      if (text === null) throw new Error('CV document not found');
      const snapshot = await this.candidates.findGithubSnapshot(candidateId);
      const textChunks = chunkCandidate(text, snapshot);

      // Slow network call: deliberately outside any DB transaction. With
      // nothing to embed there is no call, but the candidate is still marked
      // (and old chunks cleared) so the startup sweep doesn't loop on it.
      const { vectors } = await this.llm.embed(textChunks.map((c) => c.text));
      const embedded: NewCandidateChunk[] = textChunks.map((chunk, index) => ({
        ...chunk,
        embedding: vectors[index],
      }));
      const saved = await this.saveIfCurrent(
        candidateId,
        cvDocumentId,
        embedded,
      );
      // After the commit, so a score job never sees the old chunks.
      if (saved) await this.enqueuePendingScores(candidateId);
    } catch (error) {
      // Never log the CV text or the key.
      this.logger.error(
        `Embedding CV ${cvDocumentId} for candidate ${candidateId} failed: ${
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : 'unknown error'
        }`,
      );
      throw error;
    }
  }

  /**
   * Replaces the chunks and records the version they belong to, in one
   * transaction, unless a newer CV was parsed while the embedding call ran.
   */
  @Transactional()
  private async saveIfCurrent(
    candidateId: string,
    cvDocumentId: string,
    embedded: NewCandidateChunk[],
  ): Promise<boolean> {
    const current = await this.candidates.findEmbedState(candidateId);
    if (current?.parsedCvDocumentId !== cvDocumentId) {
      this.logger.log(
        `Dropping embeddings for candidate ${candidateId}: CV ${cvDocumentId} is no longer the parsed one`,
      );
      return false;
    }
    await this.chunks.replaceForCandidate(
      candidateId,
      cvDocumentId,
      embedded,
      this.llm.embeddingModel,
    );
    await this.candidates.markEmbedded(candidateId, cvDocumentId);
    return true;
  }

  /**
   * `rag` scoring waits (stays `pending`) for the chunks, so the score jobs of
   * this candidate are queued now. Harmless in `full_text` mode: a score that
   * is already queued or done makes the job a no-op. A failed enqueue is only
   * logged: the embedding is done, and the startup sweep re-queues pending
   * scores.
   */
  private async enqueuePendingScores(candidateId: string): Promise<void> {
    try {
      const pending = await this.scores.findPendingByCandidate(candidateId);
      await this.jobs.enqueueScores(pending);
    } catch (error) {
      this.logger.error(
        `Failed to enqueue pending scores of candidate ${candidateId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
}
