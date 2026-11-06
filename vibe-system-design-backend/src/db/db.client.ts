import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type DrizzleDb = PostgresJsDatabase<typeof schema>;

export function createDb(url: string): { db: DrizzleDb; close(): Promise<void> } {
  // DATABASE_URL points at the transaction pooler on 6543, which has no
  // session state. Prepared statements must stay off.
  const client = postgres(url, { prepare: false });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}
