import { Module, Global, type OnModuleDestroy, Inject } from '@nestjs/common';
import { createDb, type DrizzleDb } from './db.client.js';

export type { DrizzleDb };

export const DB = Symbol('DB');
export const DB_CONNECTION = Symbol('DB_CONNECTION');

@Global()
@Module({
  providers: [
    {
      provide: DB_CONNECTION,
      useFactory: () => {
        const url = process.env.DATABASE_URL;
        if (!url) {
          throw new Error('DATABASE_URL environment variable is required');
        }
        return createDb(url);
      },
    },
    {
      provide: DB,
      useFactory: (conn: { db: DrizzleDb; close(): Promise<void> }) => conn.db,
      inject: [DB_CONNECTION],
    },
  ],
  exports: [DB, DB_CONNECTION],
})
export class DbModule implements OnModuleDestroy {
  constructor(
    @Inject(DB_CONNECTION)
    private readonly connection: { db: DrizzleDb; close(): Promise<void> },
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.connection.close();
  }
}
