import { Inject, Injectable, Logger } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { ClsService } from 'nestjs-cls';
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
} from '../llm/application-scorer.js';
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
    private readonly scorer: ApplicationScorer,
    private readonly jobs: JobsService,
    private readonly cls: ClsService,
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
    // Duplicate job: already scored against this CV and these criteria.
    if (
      state.status === 'scored' &&
      state.scoreCvDocumentId === cvDocumentId &&
      state.scoreCriteriaHash === hash
    ) {
      return;
    }

    // Criteria missing or outdated: extraction runs first and enqueues the
    // vacancy's pending scores (this one included) when it is done.
    if (!state.vacancyCriteria || state.vacancyCriteriaHash !== hash) {
      await this.jobs.enqueueCriteria(state.vacancyId);
      return;
    }
    const criteria = state.vacancyCriteria;

    try {
      // Guarded: a newer job may already have finished (`scored`).
      if (!(await this.scores.markScoring(applicationId))) return;

      const cvText = await this.cvDocuments.findTextById(cvDocumentId);
      if (cvText === null) throw new Error('CV document not found');
      const github = await this.candidates.findGithubSnapshot(
        state.candidateId,
      );

      // Slow network call: deliberately outside any DB transaction.
      const scored = await this.scorer.score({ criteria, cvText, github });

      const outcome = await this.saveIfCurrent(
        applicationId,
        cvDocumentId,
        hash,
        scored,
      );
      if (outcome === 'criteria_changed') {
        await this.requeue(applicationId);
      }
    } catch (error) {
      await this.recordFailure(applicationId, error);
    }
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
        mode: 'full_text',
        scoredAt: new Date().toISOString(),
      },
      cvDocumentId,
      criteriaHash,
      model: scored.usage.model,
      mode: 'full_text',
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
