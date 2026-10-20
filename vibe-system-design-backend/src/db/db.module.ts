import { Global, Module, type OnModuleDestroy } from '@nestjs/common';

import { createDb, type DrizzleDb } from './db.client.js';

/** The token that holds the Drizzle instance. */
export const DB = Symbol('DB');

/** The token that holds the postgres.js client and its close function. */
export const DB_CONNECTION = Symbol('DB_CONNECTION');

export interface DbConnection {
  readonly db: DrizzleDb;
  close(): Promise<void>;
}

@Global()
@Module({
  providers: [
    {
      provide: DB_CONNECTION,
      useFactory: (): DbConnection => {
        const url = process.env.DATABASE_URL;
        if (!url) {
          throw new Error(
            'DATABASE_URL is missing. The chat needs a Postgres connection to store its messages.',
          );
        }
        return createDb(url);
      },
    },
    {
      provide: DB,
      useFactory: (connection: DbConnection): DrizzleDb => connection.db,
      inject: [DB_CONNECTION],
    },
  ],
  exports: [DB, DB_CONNECTION],
})
export class DbModule implements OnModuleDestroy {
  constructor(private readonly connection: DbConnection) {}

  async onModuleDestroy(): Promise<void> {
    await this.connection.close();
  }
}
