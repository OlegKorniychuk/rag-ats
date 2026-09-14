import { Global, Module } from '@nestjs/common';
import { DrizzleRecruitersRepository } from './repositories/drizzle-recruiters.repository';
import { RECRUITERS_REPOSITORY } from './repositories/recruiters.repository';

@Global()
@Module({
  providers: [
    { provide: RECRUITERS_REPOSITORY, useClass: DrizzleRecruitersRepository },
  ],
  exports: [RECRUITERS_REPOSITORY],
})
export class RepositoriesModule {}
