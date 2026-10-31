import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module.js';
import { VacanciesController } from './vacancies.controller.js';
import { VacanciesService } from './vacancies.service.js';

@Module({
  imports: [JobsModule],
  controllers: [VacanciesController],
  providers: [VacanciesService],
})
export class VacanciesModule {}
