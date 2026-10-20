import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema.js';

export function createDb(url: string) {
  // The connection string points at the Supabase transaction mode pooler on
  // port 6543. That pooler has no session state, so a server side prepared
  // statement would fail. `prepare: false` keeps the client on simple
  // statements.
  const client = postgres(url, { prepare: false });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}

export type DrizzleDb = ReturnType<typeof createDb>['db'];
