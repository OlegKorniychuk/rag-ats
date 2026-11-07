import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { CandidatesController } from './candidates.controller.js';
import { CandidatesService } from './candidates.service.js';
import { CandidateSearchService } from './search/candidate-search.service.js';
import {
  MIN_SIMILARITY,
  SEARCH_MIN_SIMILARITY,
} from './search/search.constants.js';

@Module({
  imports: [JobsModule, LlmModule],
  controllers: [CandidatesController],
  providers: [
    CandidatesService,
    CandidateSearchService,
    { provide: SEARCH_MIN_SIMILARITY, useValue: MIN_SIMILARITY },
  ],
})
export class CandidatesModule {}
