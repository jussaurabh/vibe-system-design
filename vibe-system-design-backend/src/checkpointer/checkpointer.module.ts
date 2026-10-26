import { Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { Pool } from 'pg';

import { loadCheckpointerConfig } from './checkpointer.config.js';
import type { CheckpointerConfig } from './checkpointer.config.js';
import {
  CHECKPOINTER_CONFIG,
  createCheckpointer,
  PG_POOL,
  POSTGRES_CHECKPOINTER,
} from './checkpointer.provider.js';

@Module({
  providers: [
    {
      provide: CHECKPOINTER_CONFIG,
      useFactory: (): CheckpointerConfig => loadCheckpointerConfig(),
    },
    {
      provide: PG_POOL,
      useFactory: (config: CheckpointerConfig): Pool =>
        new Pool({
          connectionString: config.connectionString,
          max: 5,
          idleTimeoutMillis: 30_000,
        }),
      inject: [CHECKPOINTER_CONFIG],
    },
    {
      provide: POSTGRES_CHECKPOINTER,
      useFactory: (
        pool: Pool,
        config: CheckpointerConfig,
      ): Promise<PostgresSaver> => createCheckpointer(pool, config),
      inject: [PG_POOL, CHECKPOINTER_CONFIG],
    },
  ],
  exports: [PG_POOL, POSTGRES_CHECKPOINTER],
})
export class CheckpointerModule implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
