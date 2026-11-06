import { pgTable, bigint, uuid, text, jsonb, integer, timestamp, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { SenderType, MessageStatus, MessagePart } from '../chat/chat.types.js';

export const chatMessages = pgTable(
  'chat_messages',
  {
    seq: bigint('seq', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    threadId: uuid('thread_id').notNull(),
    langgraphId: text('langgraph_id'),
    role: text('role').notNull().$type<SenderType>(),
    status: text('status').notNull().default('complete').$type<MessageStatus>(),
    parts: jsonb('parts').$type<MessagePart[]>().notNull().default([]),
    modelName: text('model_name'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    reasoningTokens: integer('reasoning_tokens'),
    latencyMs: integer('latency_ms'),
    runId: text('run_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('chat_messages_thread_msg_idx')
      .on(table.threadId, table.langgraphId)
      .where(sql`langgraph_id is not null`),
    index('chat_messages_thread_seq_idx').on(table.threadId, table.seq),
    check(
      'chat_messages_role_check',
      sql`role = any(array['user'::text, 'assistant'::text, 'system'::text, 'tool'::text])`,
    ),
    check(
      'chat_messages_status_check',
      sql`status = any(array['complete'::text, 'incomplete'::text, 'error'::text])`,
    ),
  ],
);

export type ChatMessageRow = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
