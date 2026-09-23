import { Global, Module } from '@nestjs/common';
import { DrizzleApplicationsRepository } from './repositories/drizzle-applications.repository.js';
import { DrizzleCandidatesRepository } from './repositories/drizzle-candidates.repository.js';
import { DrizzleRecruitersRepository } from './repositories/drizzle-recruiters.repository.js';
import { DrizzleVacanciesRepository } from './repositories/drizzle-vacancies.repository.js';
import { APPLICATIONS_REPOSITORY } from './repositories/applications.repository.js';
import { CANDIDATES_REPOSITORY } from './repositories/candidates.repository.js';
import { RECRUITERS_REPOSITORY } from './repositories/recruiters.repository.js';
import { VACANCIES_REPOSITORY } from './repositories/vacancies.repository.js';

@Global()
@Module({
  providers: [
    { provide: RECRUITERS_REPOSITORY, useClass: DrizzleRecruitersRepository },
    { provide: VACANCIES_REPOSITORY, useClass: DrizzleVacanciesRepository },
    { provide: CANDIDATES_REPOSITORY, useClass: DrizzleCandidatesRepository },
    {
      provide: APPLICATIONS_REPOSITORY,
      useClass: DrizzleApplicationsRepository,
    },
  ],
  exports: [
    RECRUITERS_REPOSITORY,
    VACANCIES_REPOSITORY,
    CANDIDATES_REPOSITORY,
    APPLICATIONS_REPOSITORY,
  ],
})
export class RepositoriesModule {}
