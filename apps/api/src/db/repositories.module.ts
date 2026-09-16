import { Global, Module } from '@nestjs/common';
import { DrizzleRecruitersRepository } from './repositories/drizzle-recruiters.repository.js';
import { DrizzleVacanciesRepository } from './repositories/drizzle-vacancies.repository.js';
import { RECRUITERS_REPOSITORY } from './repositories/recruiters.repository.js';
import { VACANCIES_REPOSITORY } from './repositories/vacancies.repository.js';

@Global()
@Module({
  providers: [
    { provide: RECRUITERS_REPOSITORY, useClass: DrizzleRecruitersRepository },
    { provide: VACANCIES_REPOSITORY, useClass: DrizzleVacanciesRepository },
  ],
  exports: [RECRUITERS_REPOSITORY, VACANCIES_REPOSITORY],
})
export class RepositoriesModule {}
