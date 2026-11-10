import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { TypedConfigModule } from 'nest-typed-config';
import { configureApp } from '../src/app.setup.js';
import { AppModule } from '../src/app.module.js';
import { EnvConfig } from '../src/config/env.config.js';
import { DRIZZLE } from '../src/db/db.tokens.js';
import {
  createTestDatabase,
  teardownTestDatabase,
  type TestDatabase,
} from './testcontainers-db.util.js';

export interface TestApp {
  app: INestApplication;
  testDb: TestDatabase;
}

/**
 * The validated `EnvConfig` instance AppModule's `TypedConfigModule.forRoot()`
 * built at import time. It is shared by every app created from AppModule in
 * one test file, so it must be copied, never mutated.
 */
function loadedEnvConfig(): EnvConfig {
  const imports = Reflect.getMetadata('imports', AppModule) as Array<{
    module?: unknown;
    providers?: Array<{ provide: unknown; useValue?: EnvConfig }>;
  }>;
  const config = imports
    .find((entry) => entry.module === TypedConfigModule)
    ?.providers?.find((provider) => provider.provide === EnvConfig)?.useValue;
  if (!config) throw new Error('AppModule has no loaded EnvConfig');
  return config;
}

// Test.createTestingModule()'s app never runs main.ts, so configureApp is
// called here too, to keep e2e tests representative of the real bootstrapped app.
//
// Required env vars (DATABASE_URL, JWT_SECRET, ...) are NOT set here: the
// `import { AppModule }` above already evaluates TypedConfigModule.forRoot()'s
// validation the moment this file is loaded, before this function ever
// runs - they're seeded by jest.e2e.config.js's `setupFiles` instead, which
// runs before any test file's imports.
export interface CreateTestAppOptions {
  /**
   * Overrides config values for this app only (e.g. `SCORING_MODE: 'rag'`).
   * The app gets a copy of the loaded `EnvConfig`; other apps are unaffected.
   */
  env?: Partial<EnvConfig>;
  beforeInit?: (app: INestApplication) => void;
  /** Adds provider overrides before the module is compiled. */
  overrides?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

export async function createTestApp(
  options: CreateTestAppOptions = {},
): Promise<TestApp> {
  const testDb = await createTestDatabase();

  const builder = Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(DRIZZLE)
    .useValue(testDb.db);
  if (options.env) {
    const base = loadedEnvConfig();
    builder
      .overrideProvider(EnvConfig)
      .useValue(
        Object.assign(
          Object.create(Object.getPrototypeOf(base)),
          base,
          options.env,
        ),
      );
  }
  const moduleRef = await (options.overrides?.(builder) ?? builder).compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  options.beforeInit?.(app);
  await app.init();

  return { app, testDb };
}

export async function closeTestApp({ app, testDb }: TestApp): Promise<void> {
  await app.close();
  await teardownTestDatabase(testDb);
}
