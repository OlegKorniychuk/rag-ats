import { Inject, Injectable } from '@nestjs/common';
import { PgBoss } from 'pg-boss';
import {
  EXTRACT_VACANCY_CRITERIA_QUEUE,
  PARSE_CANDIDATE_QUEUE,
  SCORE_APPLICATION_QUEUE,
  type ExtractVacancyCriteriaJob,
  type ParseCandidateJob,
  type ScoreApplicationJob,
} from './jobs.constants.js';
import { PG_BOSS } from './jobs.tokens.js';

@Injectable()
export class JobsService {
  constructor(@Inject(PG_BOSS) private readonly boss: PgBoss) {}

  async enqueueParse(candidateId: string, cvDocumentId: string): Promise<void> {
    const payload: ParseCandidateJob = { candidateId, cvDocumentId };
    await this.boss.send(PARSE_CANDIDATE_QUEUE, payload);
  }

  /**
   * At most one queued OR running extraction per vacancy: the queue uses
   * pg-boss' `exclusive` policy, which makes `singletonKey` a uniqueness key
   * over queued and active jobs (a duplicate send is dropped). Concurrent score
   * jobs of one vacancy therefore share a single LLM call; the extraction job
   * enqueues all of the vacancy's pending scores when it finishes, so the
   * dropped senders are not lost. (`singletonKey` alone does nothing on a
   * `standard` queue.)
   */
  async enqueueCriteria(vacancyId: string): Promise<void> {
    const payload: ExtractVacancyCriteriaJob = { vacancyId };
    await this.boss.send(EXTRACT_VACANCY_CRITERIA_QUEUE, payload, {
      singletonKey: vacancyId,
    });
  }

  /**
   * At most one QUEUED scoring job per application (`short` policy). A job
   * that is already running does not block a new one: a parse finishing
   * mid-score must still be able to queue the rescore.
   */
  async enqueueScore(applicationId: string): Promise<void> {
    const payload: ScoreApplicationJob = { applicationId };
    await this.boss.send(SCORE_APPLICATION_QUEUE, payload, {
      singletonKey: applicationId,
    });
  }

  async enqueueScores(applicationIds: string[]): Promise<void> {
    for (const applicationId of applicationIds) {
      await this.enqueueScore(applicationId);
    }
  }
}
