import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

export const DRIZZLE = Symbol('DRIZZLE');

export type AppDatabase = NodePgDatabase;
