import {
  Inject,
  Logger,
  Module,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { PgBoss, type Job } from 'pg-boss';
import type { Pool } from 'pg';
import { EnvConfig } from '../config/env.config.js';
import { DRIZZLE, type AppDatabase } from '../db/db.tokens.js';
import {
  CANDIDATES_REPOSITORY,
  type CandidatesRepository,
} from '../db/repositories/candidates.repository.js';
import { GithubModule } from '../github/github.module.js';
import { LlmModule } from '../llm/llm.module.js';
import {
  SCORES_REPOSITORY,
  type ScoresRepository,
} from '../db/repositories/scores.repository.js';
import { ExtractVacancyCriteriaWorker } from './extract-vacancy-criteria.worker.js';
import {
  EXTRACT_VACANCY_CRITERIA_QUEUE,
  PARSE_CANDIDATE_QUEUE,
  SCORE_APPLICATION_QUEUE,
  type ExtractVacancyCriteriaJob,
  type ParseCandidateJob,
  type ScoreApplicationJob,
} from './jobs.constants.js';
import { JobsService } from './jobs.service.js';
import { PG_BOSS } from './jobs.tokens.js';
import { ParseCandidateWorker } from './parse-candidate.worker.js';
import { ScoreApplicationWorker } from './score-application.worker.js';

const STOP_TIMEOUT_MS = 5_000;

@Module({
  imports: [LlmModule, GithubModule],
  providers: [
    {
      provide: PG_BOSS,
      inject: [DRIZZLE],
      useFactory: (db: AppDatabase) => {
        // Share Drizzle's pool; pg-boss keeps its own `pgboss` schema.
        const pool = (db as AppDatabase & { $client: Pool }).$client;
        return new PgBoss({
          db: { executeSql: (text, values) => pool.query(text, values) },
        });
      },
    },
    JobsService,
    ParseCandidateWorker,
    ExtractVacancyCriteriaWorker,
    ScoreApplicationWorker,
  ],
  exports: [JobsService],
})
export class JobsModule
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(JobsModule.name);

  constructor(
    @Inject(PG_BOSS) private readonly boss: PgBoss,
    private readonly config: EnvConfig,
    private readonly jobs: JobsService,
    private readonly parseWorker: ParseCandidateWorker,
    private readonly criteriaWorker: ExtractVacancyCriteriaWorker,
    private readonly scoreWorker: ScoreApplicationWorker,
    @Inject(CANDIDATES_REPOSITORY)
    private readonly candidates: CandidatesRepository,
    @Inject(SCORES_REPOSITORY)
    private readonly scores: ScoresRepository,
  ) {}

  async onApplicationBootstrap() {
    this.boss.on('error', (error: Error) =>
      this.logger.error(`pg-boss error: ${error.message}`),
    );
    await this.boss.start();
    // Failures are recorded on the row (candidate / score); the SDK already
    // retries transient HTTP errors, so no job-level retries.
    // Queue policies make `singletonKey` a uniqueness key: `exclusive` = one
    // queued or running job per vacancy; `short` = one queued job per
    // application (a running one doesn't block the next).
    await this.boss.createQueue(PARSE_CANDIDATE_QUEUE, { retryLimit: 0 });
    await this.boss.createQueue(EXTRACT_VACANCY_CRITERIA_QUEUE, {
      retryLimit: 0,
      policy: 'exclusive',
    });
    await this.boss.createQueue(SCORE_APPLICATION_QUEUE, {
      retryLimit: 0,
      policy: 'short',
    });
    const workOptions = {
      localConcurrency: 2,
      batchSize: 1,
      pollingIntervalSeconds: this.config.JOBS_POLL_INTERVAL_SECONDS,
    };
    await this.boss.work<ParseCandidateJob>(
      PARSE_CANDIDATE_QUEUE,
      workOptions,
      async (jobs: Job<ParseCandidateJob>[]) => {
        for (const job of jobs) await this.parseWorker.handle(job.data);
      },
    );
    await this.boss.work<ExtractVacancyCriteriaJob>(
      EXTRACT_VACANCY_CRITERIA_QUEUE,
      workOptions,
      async (jobs: Job<ExtractVacancyCriteriaJob>[]) => {
        for (const job of jobs) await this.criteriaWorker.handle(job.data);
      },
    );
    await this.boss.work<ScoreApplicationJob>(
      SCORE_APPLICATION_QUEUE,
      workOptions,
      async (jobs: Job<ScoreApplicationJob>[]) => {
        for (const job of jobs) await this.scoreWorker.handle(job.data);
      },
    );
    await this.sweepBacklog();
  }

  /**
   * Re-enqueues candidates left pending/parsing and scores left pending/scoring
   * for parsed candidates (e.g. a crash before enqueue or mid-job).
   */
  private async sweepBacklog() {
    const backlog = await this.candidates.findParseBacklog();
    for (const { candidateId, cvDocumentId } of backlog) {
      await this.jobs.enqueueParse(candidateId, cvDocumentId);
    }
    if (backlog.length > 0) {
      this.logger.log(`Startup sweep enqueued ${backlog.length} parse job(s)`);
    }
    const scoreBacklog = await this.scores.findBacklog();
    await this.jobs.enqueueScores(scoreBacklog);
    if (scoreBacklog.length > 0) {
      this.logger.log(
        `Startup sweep enqueued ${scoreBacklog.length} score job(s)`,
      );
    }
  }

  async beforeApplicationShutdown() {
    await this.boss.stop({
      graceful: true,
      timeout: STOP_TIMEOUT_MS,
      close: false,
    });
  }
}
