import { Inject, Injectable } from '@nestjs/common';
import { PgBoss } from 'pg-boss';
import {
  PARSE_CANDIDATE_QUEUE,
  type ParseCandidateJob,
} from './jobs.constants.js';
import { PG_BOSS } from './jobs.tokens.js';

@Injectable()
export class JobsService {
  constructor(@Inject(PG_BOSS) private readonly boss: PgBoss) {}

  async enqueueParse(candidateId: string, cvDocumentId: string): Promise<void> {
    const payload: ParseCandidateJob = { candidateId, cvDocumentId };
    await this.boss.send(PARSE_CANDIDATE_QUEUE, payload);
  }
}
