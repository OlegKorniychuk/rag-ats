import { Module } from '@nestjs/common';
import {
  MIN_SIMILARITY,
  SEARCH_MIN_SIMILARITY,
} from '../candidates/search/search.constants.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { MATCH_FLOOR, MATCH_FLOOR_TOKEN } from './matches/matches.constants.js';
import { VacancyMatchService } from './matches/vacancy-match.service.js';
import { VacanciesController } from './vacancies.controller.js';
import { VacanciesService } from './vacancies.service.js';

@Module({
  imports: [JobsModule, LlmModule],
  controllers: [VacanciesController],
  providers: [
    VacanciesService,
    VacancyMatchService,
    { provide: MATCH_FLOOR_TOKEN, useValue: MATCH_FLOOR },
    { provide: SEARCH_MIN_SIMILARITY, useValue: MIN_SIMILARITY },
  ],
})
export class VacanciesModule {}
