import { Inject, Injectable, Logger } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import type { RetrievedChunk, ScoringMode } from '@rag-ats/shared';
import { ClsService } from 'nestjs-cls';
import { EnvConfig } from '../config/env.config.js';
import {
  CANDIDATE_CHUNKS_REPOSITORY,
  type CandidateChunksRepository,
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
import {
  ApplicationScorer,
  LlmScoreError,
  type ApplicationScoreResult,
  type ScoringCriterion,
} from '../llm/application-scorer.js';
import type { CriterionEvidence } from '../llm/prompts/application-score-rag.prompt.js';
import { LlmClient } from '../llm/llm-client.js';
import { RAG_CHUNKS_PER_CRITERION } from '../rag/nearest-chunks.js';
import { vacancyCriteriaHash } from '../scoring/criteria-hash.js';
import type { ScoreApplicationJob } from './jobs.constants.js';
import { JobsService } from './jobs.service.js';

export const GENERIC_SCORE_ERROR = 'Could not score the application';

type SaveOutcome = 'saved' | 'cv_changed' | 'criteria_changed';

@Injectable()
export class ScoreApplicationWorker {
  private readonly logger = new Logger(ScoreApplicationWorker.name);

  constructor(
    @Inject(SCORES_REPOSITORY)
    private readonly scores: ScoresRepository,
    @Inject(CANDIDATES_REPOSITORY)
    private readonly candidates: CandidatesRepository,
    @Inject(CV_DOCUMENTS_REPOSITORY)
    private readonly cvDocuments: CvDocumentsRepository,
    @Inject(CANDIDATE_CHUNKS_REPOSITORY)
    private readonly chunks: CandidateChunksRepository,
    private readonly scorer: ApplicationScorer,
    private readonly llm: LlmClient,
    private readonly jobs: JobsService,
    private readonly cls: ClsService,
    private readonly config: EnvConfig,
  ) {}

  /** Own CLS context per job (see ParseCandidateWorker.handle). */
  handle(job: ScoreApplicationJob): Promise<void> {
    return this.cls.run(() => this.process(job));
  }

  private async process({ applicationId }: ScoreApplicationJob): Promise<void> {
    const state = await this.scores.findScoreState(applicationId);
    if (!state) return;

    const hash = vacancyCriteriaHash(
      state.vacancyTitle,
      state.vacancyRequirements,
    );
    const cvDocumentId = state.candidateParsedCvDocumentId;

    // Waiting for the CV: staying `pending` is right, the parse job enqueues
    // scoring when it finishes.
    if (state.candidateParseStatus !== 'parsed' || !cvDocumentId) return;
    // Nothing requested: every path that wants a (re)score first resets the
    // row to `pending` (apply/add, a new CV, rescore, an open-vacancy edit,
    // reopen). A leftover duplicate job (e.g. queued by both the parse and the
    // embed job) must not rescore a `scored` row, even an outdated one: a
    // closed vacancy's outdated scores wait for the reopen (step 6).
    if (state.status === 'scored') return;

    // Criteria missing or outdated: extraction runs first and enqueues the
    // vacancy's pending scores (this one included) when it is done.
    if (!state.vacancyCriteria || state.vacancyCriteriaHash !== hash) {
      await this.jobs.enqueueCriteria(state.vacancyId);
      return;
    }
    const criteria = state.vacancyCriteria;
    const mode = this.config.SCORING_MODE;

    try {
      // `rag` scores from the candidate's chunks: until they are built from
      // the parsed CV, stay `pending`; the embed job enqueues this score when
      // it finishes (no LLM call, nothing marked).
      if (mode === 'rag' && !(await this.isEmbedded(state.candidateId))) return;

      // Guarded: a newer job may already have finished (`scored`).
      if (!(await this.scores.markScoring(applicationId))) return;

      const scored =
        mode === 'rag'
          ? await this.scoreFromChunks(state.candidateId, criteria)
          : await this.scoreFullText(state.candidateId, cvDocumentId, criteria);

      const outcome = await this.saveIfCurrent(
        applicationId,
        cvDocumentId,
        hash,
        scored,
        mode,
      );
      if (outcome === 'criteria_changed') {
        await this.requeue(applicationId);
      }
    } catch (error) {
      await this.recordFailure(applicationId, error);
    }
  }

  private async isEmbedded(candidateId: string): Promise<boolean> {
    const embed = await this.candidates.findEmbedState(candidateId);
    return (
      !!embed?.parsedCvDocumentId &&
      embed.embeddedCvDocumentId === embed.parsedCvDocumentId
    );
  }

  private async scoreFullText(
    candidateId: string,
    cvDocumentId: string,
    criteria: ScoringCriterion[],
  ): Promise<ApplicationScoreResult> {
    const cvText = await this.cvDocuments.findTextById(cvDocumentId);
    if (cvText === null) throw new Error('CV document not found');
    const github = await this.candidates.findGithubSnapshot(candidateId);

    // Slow network call: deliberately outside any DB transaction.
    return this.scorer.score({ criteria, cvText, github });
  }

  /** `rag` mode: the candidate's nearest chunks per criterion, then score from them only. */
  private async scoreFromChunks(
    candidateId: string,
    criteria: ScoringCriterion[],
  ): Promise<ApplicationScoreResult> {
    const { vectors } = await this.llm.embed(criteria.map((c) => c.text));
    const evidence: CriterionEvidence[] = [];
    for (const [index, criterion] of criteria.entries()) {
      const hits = await this.chunks.findNearest(
        vectors[index],
        RAG_CHUNKS_PER_CRITERION,
        { candidateId },
      );
      const chunks: RetrievedChunk[] = hits.map((hit) => ({
        source: hit.source,
        text: hit.text,
        similarity: Math.round(hit.similarity * 1000) / 1000,
      }));
      evidence.push({ criterionId: criterion.id, chunks });
    }
    return this.scorer.scoreRag({ criteria, evidence });
  }

  /**
   * Nothing else triggers a rescore when only the vacancy changed, so the job
   * re-queues itself (it re-extracts criteria first). A failed enqueue is not a
   * scoring failure: the row is `pending` and the startup sweep picks it up.
   */
  private async requeue(applicationId: string): Promise<void> {
    try {
      await this.jobs.enqueueScore(applicationId);
    } catch (error) {
      this.logger.error(
        `Failed to re-enqueue scoring of application ${applicationId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  /**
   * Saves only if the CV and the vacancy criteria are still the ones the score
   * was computed from. A stale result is dropped:
   * - CV changed: the parse that replaced the CV already reset this score to
   *   `pending` and enqueued a new job, which owns it; touching the row here
   *   could clobber that job's `scoring` state, so nothing is written.
   * - Only the vacancy changed: no other trigger exists, so the score goes back
   *   to `pending` (committed) and the caller re-enqueues it.
   */
  @Transactional()
  private async saveIfCurrent(
    applicationId: string,
    cvDocumentId: string,
    criteriaHash: string,
    scored: ApplicationScoreResult,
    mode: ScoringMode,
  ): Promise<SaveOutcome> {
    const current = await this.scores.findScoreState(applicationId);
    if (!current) return 'cv_changed';

    if (current.candidateParsedCvDocumentId !== cvDocumentId) {
      this.logger.log(
        `Dropping score for application ${applicationId}: the candidate's CV changed`,
      );
      return 'cv_changed';
    }
    const currentHash = vacancyCriteriaHash(
      current.vacancyTitle,
      current.vacancyRequirements,
    );
    if (currentHash !== criteriaHash) {
      this.logger.log(
        `Dropping score for application ${applicationId}: the vacancy changed`,
      );
      await this.scores.resetToPending(applicationId);
      return 'criteria_changed';
    }

    await this.scores.saveResult(applicationId, {
      result: {
        overall: scored.overall,
        rationale: scored.rationale,
        criteria: scored.criteria,
        cvDocumentId,
        model: scored.usage.model,
        mode,
        scoredAt: new Date().toISOString(),
      },
      cvDocumentId,
      criteriaHash,
      model: scored.usage.model,
      mode,
      inputTokens: scored.usage.inputTokens,
      outputTokens: scored.usage.outputTokens,
    });
    return 'saved';
  }

  private async recordFailure(
    applicationId: string,
    error: unknown,
  ): Promise<void> {
    // Log the real error (never the CV text or the key); store only a safe message.
    this.logger.error(
      `Scoring application ${applicationId} failed: ${
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : 'unknown error'
      }`,
    );
    try {
      const message =
        error instanceof LlmScoreError ? error.message : GENERIC_SCORE_ERROR;
      await this.scores.markFailed(applicationId, message);
    } catch (recordError) {
      this.logger.error(
        `Could not record scoring failure for application ${applicationId}: ${
          recordError instanceof Error ? recordError.message : 'unknown error'
        }`,
      );
    }
  }
}
