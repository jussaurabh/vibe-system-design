import { getTableConfig } from 'drizzle-orm/pg-core';

import { AI_CHAT_SCHEMA, chatMessages, chatSessions } from './schema.js';

describe('chat schema', () => {
  it('puts both tables in the ai chat schema', () => {
    expect(AI_CHAT_SCHEMA).toBe('vibe_system_design_ai_chat');
    expect(getTableConfig(chatSessions).schema).toBe(AI_CHAT_SCHEMA);
    expect(getTableConfig(chatMessages).schema).toBe(AI_CHAT_SCHEMA);
  });

  it('names the tables in snake_case', () => {
    expect(getTableConfig(chatSessions).name).toBe('chat_sessions');
    expect(getTableConfig(chatMessages).name).toBe('chat_messages');
  });

  it('stores every time as epoch milliseconds in a bigint', () => {
    for (const table of [chatSessions, chatMessages]) {
      for (const name of ['created_at', 'updated_at', 'last_message_at']) {
        const column = getTableConfig(table).columns.find((c) => c.name === name);
        if (!column) continue;
        // Drizzle names the number mode bigint builder `PgBigInt53`.
        expect(column.columnType).toBe('PgBigInt53');
        expect(column.dataType).toBe('number');
      }
    }
  });

  it('makes the seq unique inside a session', () => {
    const unique = getTableConfig(chatMessages).uniqueConstraints;
    expect(
      unique.some((u) => u.columns.map((c) => c.name).join(',') === 'session_id,seq'),
    ).toBe(true);
  });

  it('cascades a deleted session to its messages', () => {
    const foreignKey = getTableConfig(chatMessages).foreignKeys[0];
    expect(foreignKey.reference().columns.map((c) => c.name)).toEqual(['session_id']);
    expect(foreignKey.onDelete).toBe('cascade');
  });
});
