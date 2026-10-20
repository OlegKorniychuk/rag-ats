import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import {
  SCORES_REPOSITORY,
  type ScoresRepository,
} from '../db/repositories/scores.repository.js';
import {
  VACANCIES_REPOSITORY,
  type VacanciesRepository,
} from '../db/repositories/vacancies.repository.js';
import { CriteriaExtractor } from '../llm/criteria-extractor.js';
import { vacancyCriteriaHash } from '../scoring/criteria-hash.js';
import type { ExtractVacancyCriteriaJob } from './jobs.constants.js';
import { JobsService } from './jobs.service.js';

const MAX_ATTEMPTS = 3;

export const CRITERIA_EXTRACTION_ERROR =
  'Could not extract criteria from the vacancy';

@Injectable()
export class ExtractVacancyCriteriaWorker {
  private readonly logger = new Logger(ExtractVacancyCriteriaWorker.name);

  constructor(
    @Inject(VACANCIES_REPOSITORY)
    private readonly vacancies: VacanciesRepository,
    @Inject(SCORES_REPOSITORY)
    private readonly scores: ScoresRepository,
    private readonly extractor: CriteriaExtractor,
    private readonly jobs: JobsService,
    private readonly cls: ClsService,
  ) {}

  /** Own CLS context per job (see ParseCandidateWorker.handle). */
  handle(job: ExtractVacancyCriteriaJob): Promise<void> {
    return this.cls.run(() => this.process(job));
  }

  private async process({
    vacancyId,
  }: ExtractVacancyCriteriaJob): Promise<void> {
    // The queue is `exclusive` per vacancy, so a re-enqueue from inside this
    // job would be dropped (the job itself is still active). A vacancy edited
    // during the LLM call is therefore handled by looping here instead.
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const state = await this.vacancies.findCriteriaState(vacancyId);
      if (!state) return;

      const hash = vacancyCriteriaHash(state.title, state.requirements);
      // Duplicate job (or a sibling already extracted): nothing to extract,
      // just make sure the waiting scores get going.
      if (state.criteriaHash === hash) {
        await this.enqueuePendingScores(vacancyId);
        return;
      }

      let criteria;
      try {
        // Slow network call: deliberately outside any DB transaction.
        ({ criteria } = await this.extractor.extract(
          state.title,
          state.requirements,
        ));
      } catch (error) {
        await this.recordFailure(vacancyId, error);
        return;
      }

      // Guarded by the vacancy's CURRENT title/requirements hash.
      if (await this.vacancies.saveCriteria(vacancyId, criteria, hash)) {
        await this.enqueuePendingScores(vacancyId);
        return;
      }
      this.logger.log(
        `Dropping criteria for vacancy ${vacancyId}: it changed during extraction (attempt ${attempt})`,
      );
    }
    // Edited on every attempt: leave the scores `pending`; the next score
    // trigger (rescore, parse, startup sweep) starts a fresh extraction.
    this.logger.warn(
      `Gave up extracting criteria for vacancy ${vacancyId}: it kept changing`,
    );
  }

  private async enqueuePendingScores(vacancyId: string): Promise<void> {
    await this.jobs.enqueueScores(
      await this.scores.findPendingByVacancy(vacancyId),
    );
  }

  private async recordFailure(
    vacancyId: string,
    error: unknown,
  ): Promise<void> {
    // Log the real error (never the vacancy text); store only a safe message.
    this.logger.error(
      `Extracting criteria for vacancy ${vacancyId} failed: ${
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : 'unknown error'
      }`,
    );
    try {
      for (const applicationId of await this.scores.findPendingByVacancy(
        vacancyId,
      )) {
        await this.scores.markFailed(applicationId, CRITERIA_EXTRACTION_ERROR);
      }
    } catch (recordError) {
      this.logger.error(
        `Could not record criteria failure for vacancy ${vacancyId}: ${
          recordError instanceof Error ? recordError.message : 'unknown error'
        }`,
      );
    }
  }
}
