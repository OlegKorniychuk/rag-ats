import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import type { ApplicationQuestions, ApplicationScore } from '@rag-ats/shared';
import {
  APPLICATIONS_REPOSITORY,
  type Application,
  type ApplicationsRepository,
} from '../db/repositories/applications.repository.js';
import {
  QUESTIONS_REPOSITORY,
  type QuestionsRepository,
} from '../db/repositories/questions.repository.js';
import {
  SCORES_REPOSITORY,
  type ScoresRepository,
} from '../db/repositories/scores.repository.js';
import { JobsService } from '../jobs/jobs.service.js';
import type { UpdateApplicationDto } from './dto/update-application.dto.js';

@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger(ApplicationsService.name);

  constructor(
    @Inject(APPLICATIONS_REPOSITORY)
    private readonly applicationsRepository: ApplicationsRepository,
    @Inject(SCORES_REPOSITORY)
    private readonly scoresRepository: ScoresRepository,
    @Inject(QUESTIONS_REPOSITORY)
    private readonly questionsRepository: QuestionsRepository,
    private readonly jobs: JobsService,
  ) {}

  async updateStage(
    recruiterId: string,
    applicationId: string,
    dto: UpdateApplicationDto,
  ): Promise<Application> {
    const application =
      await this.applicationsRepository.findByIdWithVacancy(applicationId);

    // same 404 for "doesn't exist" and "exists but isn't yours" - don't let
    // a client distinguish which one it is
    if (!application || application.vacancy.recruiterId !== recruiterId) {
      throw new NotFoundException('Application not found');
    }

    return this.applicationsRepository.updateStage(applicationId, dto.stage);
  }

  async rescore(
    recruiterId: string,
    applicationId: string,
  ): Promise<ApplicationScore> {
    await this.resetScore(recruiterId, applicationId);
    // Read before enqueueing: the response is the freshly reset (`pending`)
    // score, not whatever the worker has moved it to by the time we answer.
    const score =
      await this.scoresRepository.findApplicationScore(applicationId);
    if (!score) throw new NotFoundException('Application not found');
    // After commit, so the worker sees `pending`. A failed enqueue is not a
    // request failure: the score stays `pending` and the startup sweep (parsed
    // candidates) re-enqueues it.
    try {
      await this.jobs.enqueueScore(applicationId);
    } catch (error) {
      this.logger.error(
        `Failed to enqueue rescoring of application ${applicationId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
    return score;
  }

  @Transactional()
  private async resetScore(
    recruiterId: string,
    applicationId: string,
  ): Promise<void> {
    const application =
      await this.applicationsRepository.findByIdWithVacancy(applicationId);
    // same 404 as updateStage: don't reveal whether the application exists
    if (!application || application.vacancy.recruiterId !== recruiterId) {
      throw new NotFoundException('Application not found');
    }

    const state = await this.scoresRepository.findScoreState(applicationId);
    if (state?.status === 'scoring') {
      throw new ConflictException('Scoring already in progress');
    }
    if (!state) await this.scoresRepository.createPending(applicationId);
    else await this.scoresRepository.resetToPending(applicationId);
  }

  async getQuestions(
    recruiterId: string,
    applicationId: string,
  ): Promise<ApplicationQuestions> {
    await this.assertOwned(recruiterId, applicationId);
    return this.questionsRepository.findApplicationQuestions(applicationId);
  }

  async requestQuestions(
    recruiterId: string,
    applicationId: string,
  ): Promise<ApplicationQuestions> {
    await this.resetQuestions(recruiterId, applicationId);
    // Read before enqueueing, as in rescore: the response is the freshly
    // reset (`pending`) state.
    const questions =
      await this.questionsRepository.findApplicationQuestions(applicationId);
    // After commit, so the worker sees `pending`. A failed enqueue is not a
    // request failure: the row stays `pending` and the startup sweep picks it up.
    try {
      await this.jobs.enqueueQuestions(applicationId);
    } catch (error) {
      this.logger.error(
        `Failed to enqueue questions for application ${applicationId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
    return questions;
  }

  @Transactional()
  private async resetQuestions(
    recruiterId: string,
    applicationId: string,
  ): Promise<void> {
    await this.assertOwned(recruiterId, applicationId);
    const score =
      await this.scoresRepository.findApplicationScore(applicationId);
    if (!score || score.status !== 'scored' || score.stale) {
      throw new ConflictException('Score the application first');
    }
    const state = await this.questionsRepository.findState(applicationId);
    if (state?.status === 'pending' || state?.status === 'generating') {
      throw new ConflictException('Questions are already being generated');
    }
    await this.questionsRepository.resetToPending(applicationId);
  }

  /** Same 404 for "doesn't exist" and "isn't yours" (see updateStage). */
  private async assertOwned(
    recruiterId: string,
    applicationId: string,
  ): Promise<void> {
    const application =
      await this.applicationsRepository.findByIdWithVacancy(applicationId);
    if (!application || application.vacancy.recruiterId !== recruiterId) {
      throw new NotFoundException('Application not found');
    }
  }
}
