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
  QUESTIONS_REPOSITORY,
  type QuestionScoreState,
  type QuestionState,
  type QuestionsRepository,
} from '../db/repositories/questions.repository.js';
import {
  LlmQuestionError,
  LlmQuestionGroundingError,
  QuestionGenerator,
  type QuestionGenerationResult,
} from '../llm/question-generator.js';
import type { GenerateQuestionsJob } from './jobs.constants.js';

export const GENERIC_QUESTIONS_ERROR = 'Could not generate questions';
export const SCORE_CHANGED_ERROR =
  'The fit score changed while generating; generate again';
export const SCORE_NOT_READY_ERROR = 'The fit score is not ready';

/** The score the questions are generated from: `scored` and current. */
interface UsableScore extends QuestionScoreState {
  result: NonNullable<QuestionScoreState['result']>;
  cvDocumentId: string;
  criteriaHash: string;
  scoredAt: Date;
}

/** The score is `scored` and was computed from the current CV and criteria. */
function usableScore(state: QuestionState): UsableScore | null {
  const score = state.score;
  if (
    !score ||
    score.status !== 'scored' ||
    !score.result ||
    !score.scoredAt ||
    !score.cvDocumentId ||
    !score.criteriaHash ||
    score.cvDocumentId !== state.candidateParsedCvDocumentId ||
    score.criteriaHash !== state.vacancyCriteriaHash
  ) {
    return null;
  }
  return score as UsableScore;
}

@Injectable()
export class GenerateQuestionsWorker {
  private readonly logger = new Logger(GenerateQuestionsWorker.name);

  constructor(
    @Inject(QUESTIONS_REPOSITORY)
    private readonly questions: QuestionsRepository,
    @Inject(CANDIDATES_REPOSITORY)
    private readonly candidates: CandidatesRepository,
    @Inject(CV_DOCUMENTS_REPOSITORY)
    private readonly cvDocuments: CvDocumentsRepository,
    private readonly generator: QuestionGenerator,
    private readonly cls: ClsService,
  ) {}

  /** Own CLS context per job (see ParseCandidateWorker.handle). */
  handle(job: GenerateQuestionsJob): Promise<void> {
    return this.cls.run(() => this.process(job));
  }

  private async process({
    applicationId,
  }: GenerateQuestionsJob): Promise<void> {
    const state = await this.questions.findState(applicationId);
    // Nothing requested (or already done): every request resets the row to
    // `pending` first. `generating` is a job recovered after a crash.
    if (
      !state ||
      (state.status !== 'pending' && state.status !== 'generating')
    ) {
      return;
    }

    try {
      const score = usableScore(state);
      if (!score) {
        await this.questions.markFailed(
          applicationId,
          SCORE_NOT_READY_ERROR,
          null,
        );
        return;
      }
      // Guarded: another job may already have finished.
      if (!(await this.questions.markGenerating(applicationId))) return;

      const cvText = await this.cvDocuments.findTextById(score.cvDocumentId);
      if (cvText === null) throw new Error('CV document not found');
      const github = await this.candidates.findGithubSnapshot(
        state.candidateId,
      );

      // Slow network call: deliberately outside any DB transaction.
      const generated = await this.generator.generate({
        vacancy: {
          title: state.vacancyTitle,
          requirements: state.vacancyRequirements,
        },
        score: score.result,
        cvText,
        github,
      });

      await this.saveIfCurrent(applicationId, score, generated);
    } catch (error) {
      await this.recordFailure(applicationId, error);
    }
  }

  /**
   * Saves only if the score is still the one the questions were generated
   * from (same `scored_at`, CV and criteria). Otherwise the row fails with
   * SCORE_CHANGED_ERROR and keeps its previous result (shown as stale), so it
   * is never left `pending` without a job.
   */
  @Transactional()
  private async saveIfCurrent(
    applicationId: string,
    used: UsableScore,
    generated: QuestionGenerationResult,
  ): Promise<void> {
    const current = await this.questions.findState(applicationId);
    if (!current) return;
    const score = usableScore(current);
    if (
      !score ||
      score.scoredAt.getTime() !== used.scoredAt.getTime() ||
      score.cvDocumentId !== used.cvDocumentId ||
      score.criteriaHash !== used.criteriaHash
    ) {
      this.logger.log(
        `Dropping questions for application ${applicationId}: the fit score changed`,
      );
      await this.questions.markFailed(applicationId, SCORE_CHANGED_ERROR, null);
      return;
    }
    await this.questions.saveResult(applicationId, {
      result: {
        questions: generated.questions,
        cvDocumentId: used.cvDocumentId,
        model: generated.usage.model,
        generatedAt: new Date().toISOString(),
      },
      cvDocumentId: used.cvDocumentId,
      criteriaHash: used.criteriaHash,
      scoreScoredAt: used.scoredAt,
      model: generated.usage.model,
      inputTokens: generated.usage.inputTokens,
      outputTokens: generated.usage.outputTokens,
    });
  }

  private async recordFailure(
    applicationId: string,
    error: unknown,
  ): Promise<void> {
    // Log the real error (never the CV text or the key); store only a safe message.
    this.logger.error(
      `Generating questions for application ${applicationId} failed: ${
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : 'unknown error'
      }`,
    );
    try {
      const message =
        error instanceof LlmQuestionError
          ? error.message
          : GENERIC_QUESTIONS_ERROR;
      const details =
        error instanceof LlmQuestionGroundingError ? error.problems : null;
      await this.questions.markFailed(applicationId, message, details);
    } catch (recordError) {
      this.logger.error(
        `Could not record questions failure for application ${applicationId}: ${
          recordError instanceof Error ? recordError.message : 'unknown error'
        }`,
      );
    }
  }
}
