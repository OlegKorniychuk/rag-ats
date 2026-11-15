import type { INestApplicationContext } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { AppModule } from '../../app.module.js';
import { EnvConfig } from '../../config/env.config.js';
import { LlmClient } from '../../llm/llm-client.js';
import { MeteredLlmClient, type SeedMeter } from './metering.js';

export interface SeedContextOptions {
  /** The validated env; copied, with `GITHUB_FIXTURES_DIR` forced by the caller. */
  env: EnvConfig;
  meter: SeedMeter;
  /** More provider overrides (the integration test swaps the database). */
  customize?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

/**
 * The whole app as a standalone context (no HTTP server). Its `onApplicationBootstrap`
 * starts pg-boss and the four workers in this process, exactly as the dev
 * server does, and the startup sweep re-enqueues unfinished work of a previous
 * run. `LlmClient` is replaced by the metering subclass; every consumer (the
 * parser, the criteria extractor, the scorer, the workers) injects that one
 * singleton from `LlmModule`, so the override reaches the jobs.
 *
 * Built with `@nestjs/testing` because that is Nest's supported way to
 * override a provider of an existing module graph (a dev dependency, like the
 * other eval scripts' tooling).
 */
export async function createSeedContext(
  options: SeedContextOptions,
): Promise<INestApplicationContext> {
  const env = Object.assign(
    Object.create(Object.getPrototypeOf(options.env)) as EnvConfig,
    options.env,
  );
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EnvConfig)
    .useValue(env)
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
