import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { DRIZZLE } from '../src/db/db.tokens';
import {
  createTestDatabase,
  teardownTestDatabase,
  TestDatabase,
} from './testcontainers-db.util';

export interface TestApp {
  app: INestApplication;
  testDb: TestDatabase;
}

// main.ts wires cookie-parser + the global ValidationPipe on the app instance
// NestFactory.create() returns - Test.createTestingModule()'s app never runs
// main.ts, so that wiring is replicated here to keep e2e tests representative
// of the real bootstrapped app.
export async function createTestApp(): Promise<TestApp> {
  process.env.DATABASE_URL ??=
    'postgres://test:test@localhost:5432/unused_placeholder';
  process.env.JWT_SECRET ??= 'test-secret';
  process.env.JWT_EXPIRES_IN ??= '1h';
  process.env.PORT ??= '0';
  process.env.NODE_ENV ??= 'test';

  const testDb = await createTestDatabase();

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(DRIZZLE)
    .useValue(testDb.db)
    .compile();

  const app = moduleRef.createNestApplication();
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();

  return { app, testDb };
}

export async function closeTestApp({ app, testDb }: TestApp): Promise<void> {
  await app.close();
  await teardownTestDatabase(testDb);
}
