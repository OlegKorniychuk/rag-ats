import { Module } from '@nestjs/common';
import { VacanciesController } from './vacancies.controller.js';
import { VacanciesService } from './vacancies.service.js';

@Module({
  controllers: [VacanciesController],
  providers: [VacanciesService],
})
export class VacanciesModule {}
