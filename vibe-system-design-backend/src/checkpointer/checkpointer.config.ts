import { AI_CHAT_SCHEMA } from '../db/schema.js';

export interface CheckpointerConfig {
  connectionString: string;
  schema: string;
}

export function loadCheckpointerConfig(
  env: NodeJS.ProcessEnv = process.env,
): CheckpointerConfig {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is missing. The checkpointer needs a Postgres connection string to store its checkpoint tables.',
    );
  }
  return {
    connectionString,
    schema: env.CHECKPOINTER_SCHEMA ?? AI_CHAT_SCHEMA,
  };
}
