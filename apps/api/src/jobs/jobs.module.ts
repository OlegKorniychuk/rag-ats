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
import { LlmModule } from '../llm/llm.module.js';
import {
  PARSE_CANDIDATE_QUEUE,
  type ParseCandidateJob,
} from './jobs.constants.js';
import { JobsService } from './jobs.service.js';
import { PG_BOSS } from './jobs.tokens.js';
import { ParseCandidateWorker } from './parse-candidate.worker.js';

const STOP_TIMEOUT_MS = 5_000;

@Module({
  imports: [LlmModule],
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
    private readonly worker: ParseCandidateWorker,
    @Inject(CANDIDATES_REPOSITORY)
    private readonly candidates: CandidatesRepository,
  ) {}

  async onApplicationBootstrap() {
    this.boss.on('error', (error: Error) =>
      this.logger.error(`pg-boss error: ${error.message}`),
    );
    await this.boss.start();
    // Failures are recorded on the candidate; the SDK already retries
    // transient HTTP errors, so no job-level retries.
    await this.boss.createQueue(PARSE_CANDIDATE_QUEUE, { retryLimit: 0 });
    await this.boss.work<ParseCandidateJob>(
      PARSE_CANDIDATE_QUEUE,
      {
        localConcurrency: 2,
        batchSize: 1,
        pollingIntervalSeconds: this.config.JOBS_POLL_INTERVAL_SECONDS,
      },
      async (jobs: Job<ParseCandidateJob>[]) => {
        for (const job of jobs) await this.worker.handle(job.data);
      },
    );
    await this.sweepBacklog();
  }

  /** Re-enqueues candidates left pending/parsing (e.g. a crash before enqueue). */
  private async sweepBacklog() {
    const backlog = await this.candidates.findParseBacklog();
    for (const { candidateId, cvDocumentId } of backlog) {
      await this.jobs.enqueueParse(candidateId, cvDocumentId);
    }
    if (backlog.length > 0) {
      this.logger.log(`Startup sweep enqueued ${backlog.length} parse job(s)`);
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
