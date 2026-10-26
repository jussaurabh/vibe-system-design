import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import type { Pool } from 'pg';

import { AI_CHAT_SCHEMA } from '../db/schema.js';

import { loadCheckpointerConfig } from './checkpointer.config.js';
import {
  createCheckpointer,
  hardenCheckpointTables,
} from './checkpointer.provider.js';

// The fake covers the two pool surfaces the checkpointer touches:
// `query` for the table hardening and `connect` for PostgresSaver.setup().
function fakePool() {
  const client = {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: vi.fn(),
  };
  const pool = {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: vi.fn().mockResolvedValue(client),
  };
  return { pool, client };
}

const config = {
  connectionString: 'postgres://user:secret@localhost:5432/db',
  schema: AI_CHAT_SCHEMA,
};

describe('createCheckpointer', () => {
  it('resolves a PostgresSaver instance', async () => {
    const { pool } = fakePool();

    const checkpointer = await createCheckpointer(
      pool as unknown as Pool,
      config,
    );

    expect(checkpointer).toBeInstanceOf(PostgresSaver);
  });

  it('runs setup against the migrated table inside the ai chat schema', async () => {
    const { pool, client } = fakePool();

    await createCheckpointer(pool as unknown as Pool, config);

    // PostgresSaver.setup() quotes the schema name; the pool surface only
    // covers hardening, since setup queries run through the connected client.
    expect(
      client.query.mock.calls
        .map((call) => call[0] as string)
        .some((text) =>
          text.includes(
            'SELECT v FROM "vibe_system_design_ai_chat".checkpoint_migrations',
          ),
        ),
    ).toBe(true);
  });

  it('runs setup before the hardening ALTERs', async () => {
    const { pool, client } = fakePool();
    const clientQueryOrder: string[] = [];
    const poolQueryOrder: string[] = [];
    client.query.mockImplementation(async (text: unknown) => {
      clientQueryOrder.push(String(text));
      return { rows: [] };
    });
    pool.query.mockImplementation(async (text: unknown) => {
      poolQueryOrder.push(String(text));
      return { rows: [] };
    });

    await createCheckpointer(pool as unknown as Pool, config);

    expect(clientQueryOrder.length).toBeGreaterThan(0);
    expect(poolQueryOrder.length).toBeGreaterThan(0);
    expect(clientQueryOrder.length).toBeGreaterThanOrEqual(1);
    // The first setup statement happens before any ALTER from the hardening pass.
    expect(client.query.mock.invocationCallOrder[0]).toBeLessThan(
      pool.query.mock.invocationCallOrder[0],
    );
  });

  it('hardens the four checkpoint tables', async () => {
    const { pool } = fakePool();
    const tables = [
      'checkpoints',
      'checkpoint_blobs',
      'checkpoint_writes',
      'checkpoint_migrations',
    ];

    await createCheckpointer(pool as unknown as Pool, config);

    // Hardening runs on the pool surface; the setup queries run on the client.
    const text = pool.query.mock.calls
      .map((call) => call[0] as string)
      .join('\n');
    for (const table of tables) {
      expect(text).toContain(
        `ALTER TABLE vibe_system_design_ai_chat.${table} ENABLE ROW LEVEL SECURITY`,
      );
      expect(text).toContain(
        `REVOKE ALL ON TABLE vibe_system_design_ai_chat.${table} FROM anon, authenticated`,
      );
    }
  });

  it('throws for a schema name outside the allowed pattern', async () => {
    const { pool } = fakePool();

    await expect(
      createCheckpointer(pool as unknown as Pool, {
        ...config,
        schema: 'vibe ai chat',
      }),
    ).rejects.toThrow(/schema name/i);
  });
});

describe('hardenCheckpointTables', () => {
  it('keeps startup alive when the revoke hits a database without Supabase roles', async () => {
    const { pool } = fakePool();
    pool.query.mockImplementation(async (text: unknown) => {
      if (typeof text === 'string' && text.includes('REVOKE')) {
        throw new Error('role "anon" does not exist');
      }
      return { rows: [] };
    });

    await expect(
      hardenCheckpointTables(pool as unknown as Pool, AI_CHAT_SCHEMA),
    ).resolves.toBeUndefined();
    expect(pool.query).toHaveBeenCalledTimes(8);
  });
});

describe('loadCheckpointerConfig', () => {
  it('takes DATABASE_URL and defaults the schema to the ai chat schema', () => {
    expect(
      loadCheckpointerConfig({ DATABASE_URL: 'postgres://localhost/db' }),
    ).toEqual({
      connectionString: 'postgres://localhost/db',
      schema: AI_CHAT_SCHEMA,
    });
  });

  it('prefers CHECKPOINTER_SCHEMA over the ai chat schema', () => {
    expect(
      loadCheckpointerConfig({
        DATABASE_URL: 'postgres://localhost/db',
        CHECKPOINTER_SCHEMA: 'custom_schema',
      }),
    ).toEqual({
      connectionString: 'postgres://localhost/db',
      schema: 'custom_schema',
    });
  });

  it('throws a clear error without DATABASE_URL', () => {
    expect(() => loadCheckpointerConfig({})).toThrow(/DATABASE_URL/);
  });
});
