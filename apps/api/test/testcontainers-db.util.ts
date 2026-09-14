import { join } from 'path';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { AppDatabase } from '../src/db/db.tokens';

export interface TestDatabase {
  container: StartedPostgreSqlContainer;
  pool: Pool;
  db: AppDatabase;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer('postgres:17').start();
  const pool = new Pool({ connectionString: container.getConnectionUri() });
  const db = drizzle({ client: pool });

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
