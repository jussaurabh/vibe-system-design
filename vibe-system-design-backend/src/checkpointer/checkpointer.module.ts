import { Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { Pool } from 'pg';

import { AppLogger } from '../logging/app-logger.js';
import { loadCheckpointerConfig } from './checkpointer.config.js';
import type { CheckpointerConfig } from './checkpointer.config.js';
import {
  CHECKPOINTER_CONFIG,
  createCheckpointer,
  PG_POOL,
  POSTGRES_CHECKPOINTER,
} from './checkpointer.provider.js';

const poolLogger = new AppLogger('CheckpointerPool');

@Module({
  providers: [
    {
      provide: CHECKPOINTER_CONFIG,
      useFactory: (): CheckpointerConfig => loadCheckpointerConfig(),
    },
    {
      provide: PG_POOL,
      useFactory: (config: CheckpointerConfig): Pool => {
        const pool = new Pool({
          connectionString: config.connectionString,
          max: 5,
          idleTimeoutMillis: 30_000,
        });
        // pg-pool re-emits errors of idle clients; an uncaught 'error' event
        // would throw and take the process down with the connection gone.
        pool.on('error', (err: Error) => {
          poolLogger.error('A checkpoint pool client errored', err);
        });
        return pool;
      },
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
