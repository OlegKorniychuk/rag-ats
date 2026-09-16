import { Global, Module, OnModuleDestroy } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { EnvConfig } from '../config/env.config.js';
import { Pool } from 'pg';
import { DRIZZLE } from './db.tokens.js';

@Global()
@Module({
  providers: [
    {
      provide: Pool,
      inject: [EnvConfig],
      useFactory: (config: EnvConfig) =>
        new Pool({
          connectionString: config.DATABASE_URL,
        }),
    },
    {
      provide: DRIZZLE,
      inject: [Pool],
      useFactory: (pool: Pool) => drizzle({ client: pool }),
    },
  ],
  exports: [DRIZZLE],
})
export class DbModule implements OnModuleDestroy {
  constructor(private readonly pool: Pool) {}

  async onModuleDestroy() {
    await this.pool.end();
  }
}
