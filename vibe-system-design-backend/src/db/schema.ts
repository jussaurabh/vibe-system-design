import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  unique,
} from 'drizzle-orm/pg-core';

export const AI_CHAT_SCHEMA = 'vibe_system_design_ai_chat';

const aiChat = pgSchema(AI_CHAT_SCHEMA);

export const SENDER_TYPES = ['user', 'assistant', 'system', 'tool'] as const;
export type SenderType = (typeof SENDER_TYPES)[number];

export const MESSAGE_STATUSES = ['complete', 'incomplete', 'error'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export type MessagePart =
  | { type: 'text'; text: string }
  | {
      type: 'tool';
      toolCallId: string;
      name: string;
      input?: unknown;
      output?: unknown;
      status: MessageStatus;
    };

export const chatSessions = aiChat.table(
  'chat_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    title: text('title').notNull().default(''),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
    lastMessageAt: bigint('last_message_at', { mode: 'number' }),
  },
  (table) => [
    index('chat_sessions_user_recent_idx').on(
      table.userId,
      table.lastMessageAt.desc().nullsLast(),
    ),
    check('chat_sessions_id_prefix_check', sql`starts_with(${table.id}, 'ses_')`),
  ],
);

export const chatMessages = aiChat.table(
  'chat_messages',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    seq: integer('seq').notNull(),
    senderType: text('sender_type').$type<SenderType>().notNull(),
    content: jsonb('content').$type<MessagePart[]>().notNull().default([]),
    status: text('status').$type<MessageStatus>().notNull().default('complete'),
    tokenCount: integer('token_count'),
    modelName: text('model_name'),
    latencyMs: integer('latency_ms'),
  },
  (table) => [
    foreignKey({
      columns: [table.sessionId],
      foreignColumns: [chatSessions.id],
      name: 'chat_messages_session_id_fkey',
    }).onDelete('cascade'),
    unique('chat_messages_session_seq_key').on(table.sessionId, table.seq),
    check(
      'chat_messages_sender_type_check',
      sql`${table.senderType} in ('user', 'assistant', 'system', 'tool')`,
    ),
    check(
      'chat_messages_status_check',
      sql`${table.status} in ('complete', 'incomplete', 'error')`,
    ),
    check('chat_messages_id_prefix_check', sql`starts_with(${table.id}, 'msg_')`),
  ],
);
