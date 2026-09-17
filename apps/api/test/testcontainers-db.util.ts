import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import type { AppDatabase } from '../src/db/db.tokens.js';
import { dbRelations } from '../src/db/schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface TestDatabase {
  container: StartedPostgreSqlContainer;
  pool: Pool;
  db: AppDatabase;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer('postgres:17').start();
  const pool = new Pool({ connectionString: container.getConnectionUri() });
  const db = drizzle({ client: pool, relations: dbRelations });

  await migrate(db, {
    migrationsFolder: join(__dirname, '../src/db/migrations'),
  });

  return { container, pool, db };
}

export async function teardownTestDatabase(
  testDb: TestDatabase,
): Promise<void> {
  await testDb.pool.end();
  await testDb.container.stop();
}
