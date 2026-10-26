import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { type Pool } from 'pg';

import type { CheckpointerConfig } from './checkpointer.config.js';

/** The token that holds the checkpointer config parsed from the environment. */
export const CHECKPOINTER_CONFIG = Symbol('CHECKPOINTER_CONFIG');

/** The token that holds the node-postgres pool dedicated to the checkpoint tables. */
export const PG_POOL = Symbol('PG_POOL');

/** The token that holds the initialized LangGraph PostgresSaver checkpointer. */
export const POSTGRES_CHECKPOINTER = Symbol('POSTGRES_CHECKPOINTER');

/** The tables that PostgresSaver.setup() creates in the configured schema. */
const CHECKPOINT_TABLES = [
  'checkpoints',
  'checkpoint_blobs',
  'checkpoint_writes',
  'checkpoint_migrations',
] as const;

const VALID_SCHEMA_PATTERN = /^[a-z_][a-z0-9_]*$/;

/** Accept a schema name only when it needs no quoting, and return it as the literal table prefix. */
export function quoteSchemaName(schema: string): string {
  if (!VALID_SCHEMA_PATTERN.test(schema)) {
    throw new Error(
      `Invalid checkpointer schema name: "${schema}". Use lowercase letters, digits and underscores, starting with a letter or underscore.`,
    );
  }
  return schema;
}

export async function createCheckpointer(
  pool: Pool,
  config: CheckpointerConfig,
): Promise<PostgresSaver> {
  const schema = quoteSchemaName(config.schema);
  const checkpointer = new PostgresSaver(pool, undefined, { schema });
  await checkpointer.setup();
  await hardenCheckpointTables(pool, schema);
  return checkpointer;
}

/**
 * Turn on row level security and take the Supabase anon and authenticated
 * roles away from the checkpoint tables. Every statement is idempotent, and
 * the revoke survives a local database that has no such roles.
 */
export async function hardenCheckpointTables(
  pool: Pool,
  schema: string,
): Promise<void> {
  const schemaPrefix = quoteSchemaName(schema);
  for (const table of CHECKPOINT_TABLES) {
    const tableRef = `${schemaPrefix}.${table}`;
    await pool.query(`ALTER TABLE ${tableRef} ENABLE ROW LEVEL SECURITY`);
    try {
      await pool.query(
        `REVOKE ALL ON TABLE ${tableRef} FROM anon, authenticated`,
      );
    } catch {
      // A local database has no Supabase roles. Skip the revoke and keep startup alive.
    }
  }
}
