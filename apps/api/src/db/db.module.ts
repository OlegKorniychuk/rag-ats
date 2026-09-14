import { Global, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { DRIZZLE } from './db.tokens';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: Pool,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Pool({
          connectionString: config.getOrThrow<string>('DATABASE_URL'),
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
