import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { chatMessages } from './schema.js';

describe('chatMessages schema', () => {
  it('matches the required DDL structure', () => {
    const config = getTableConfig(chatMessages);

    expect(config.name).toBe('chat_messages');
    expect(config.schema ?? 'public').toBe('public');
    expect(config.columns.map((column) => column.name)).toEqual([
      'seq',
      'thread_id',
      'langgraph_id',
      'role',
      'status',
      'parts',
      'model_name',
      'input_tokens',
      'output_tokens',
      'reasoning_tokens',
      'latency_ms',
      'run_id',
      'created_at',
    ]);
    const seq = config.columns.find((column) => column.name === 'seq');
    expect(seq?.primary).toBe(true);
    expect(seq?.columnType).toBe('PgBigInt53');
    expect(
      config.columns.find((column) => column.name === 'thread_id')?.columnType,
    ).toBe('PgUUID');
    expect(config.indexes.map((index) => index.config.name).sort()).toEqual([
      'chat_messages_thread_msg_idx',
      'chat_messages_thread_seq_idx',
    ]);
    expect(config.foreignKeys).toHaveLength(0);
    expect(config.checks.map((check) => check.name).sort()).toEqual([
      'chat_messages_role_check',
      'chat_messages_status_check',
    ]);
  });
});
