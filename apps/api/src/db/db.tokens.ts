import type { TransactionalAdapterDrizzleOrm } from '@nestjs-cls/transactional-adapter-drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { dbRelations } from './schema.js';

export const DRIZZLE = Symbol('DRIZZLE');

export type AppDatabase = NodePgDatabase<typeof dbRelations>;
export type AppTransactionAdapter = TransactionalAdapterDrizzleOrm<AppDatabase>;
