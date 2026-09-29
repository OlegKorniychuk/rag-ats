import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { configureApp } from '../src/app.setup.js';
import { AppModule } from '../src/app.module.js';
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

// Test.createTestingModule()'s app never runs main.ts, so configureApp is
// called here too, to keep e2e tests representative of the real bootstrapped app.
//
// Required env vars (DATABASE_URL, JWT_SECRET, ...) are NOT set here: the
// `import { AppModule }` above already evaluates TypedConfigModule.forRoot()'s
// validation the moment this file is loaded, before this function ever
// runs - they're seeded by jest.e2e.config.js's `setupFiles` instead, which
// runs before any test file's imports.
export interface CreateTestAppOptions {
  beforeInit?: (app: INestApplication) => void;
}

export async function createTestApp(
  options: CreateTestAppOptions = {},
): Promise<TestApp> {
  const testDb = await createTestDatabase();

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(DRIZZLE)
    .useValue(testDb.db)
    .compile();

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
