import {
  Module,
  type DynamicModule,
  type INestApplicationContext,
} from '@nestjs/common';
import { ClsPluginTransactional } from '@nestjs-cls/transactional';
import { TransactionalAdapterDrizzleOrm } from '@nestjs-cls/transactional-adapter-drizzle-orm';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { ClsModule } from 'nestjs-cls';
import { CandidateSearchService } from '../../candidates/search/candidate-search.service.js';
import {
  MIN_SIMILARITY,
  SEARCH_MIN_SIMILARITY,
} from '../../candidates/search/search.constants.js';
import { EnvConfig } from '../../config/env.config.js';
import { DbModule } from '../../db/db.module.js';
import { DRIZZLE } from '../../db/db.tokens.js';
import { RepositoriesModule } from '../../db/repositories.module.js';
import { LlmClient } from '../../llm/llm-client.js';
import { LlmModule } from '../../llm/llm.module.js';
import { MeteredLlmClient, type SeedMeter } from '../seed/metering.js';

/** The validated env as a global provider (the app's `TypedConfigModule` does this in `AppModule`). */
class EvalConfigModule {
  static forEnv(env: EnvConfig): DynamicModule {
    return {
      module: EvalConfigModule,
      global: true,
      providers: [{ provide: EnvConfig, useValue: env }],
      exports: [EnvConfig],
    };
  }
}

/**
 * Just what the eval reads with: the database, the repositories, the LLM
 * providers and `CandidateSearchService`. Deliberately NOT `JobsModule` (nor
 * `AppModule`, `CandidatesModule` or `VacanciesModule`, which import it): its
 * `onApplicationBootstrap` would start pg-boss, create its `pgboss` schema,
 * start the four workers and sweep the seeded backlog. Here nothing writes:
 * scores are computed in memory and never stored.
 */
@Module({
  imports: [
    DbModule,
    // The repositories read through `TransactionHost`, which needs the CLS
    // plugin. No middleware: there is no HTTP server.
    ClsModule.forRoot({
      global: true,
      plugins: [
        new ClsPluginTransactional({
          imports: [DbModule],
          adapter: new TransactionalAdapterDrizzleOrm({
            drizzleInstanceToken: DRIZZLE,
          }),
        }),
      ],
    }),
    RepositoriesModule,
    LlmModule,
  ],
  providers: [
    CandidateSearchService,
    { provide: SEARCH_MIN_SIMILARITY, useValue: MIN_SIMILARITY },
  ],
  exports: [CandidateSearchService],
})
export class EvalModule {}

export interface EvalContextOptions {
  /** The validated env (`DATABASE_URL` is the seeded database). */
  env: EnvConfig;
  meter: SeedMeter;
  /** More provider overrides (the integration test swaps the database). */
  customize?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

/**
 * The slim standalone context of the eval (no HTTP server, no job queue).
 * `LlmClient` is the seed's metering subclass: every consumer (the scorer, the
 * search service) injects that one singleton from `LlmModule`, so the meter
 * sees every call. Built with `@nestjs/testing` for the same reason as the
 * seed's context: it is Nest's supported way to override a provider.
 */
export async function createEvalContext(
  options: EvalContextOptions,
): Promise<INestApplicationContext> {
  let builder = Test.createTestingModule({
    imports: [EvalConfigModule.forEnv(options.env), EvalModule],
  })
    .overrideProvider(LlmClient)
    .useFactory({
      factory: (config: EnvConfig) =>
        new MeteredLlmClient(config, options.meter),
      inject: [EnvConfig],
    });
  if (options.customize) builder = options.customize(builder);
  const moduleRef = await builder.compile();
  await moduleRef.init();
  return moduleRef;
}
