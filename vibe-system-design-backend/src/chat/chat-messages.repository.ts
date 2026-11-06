import { Injectable, Inject } from '@nestjs/common';
import { eq, asc } from 'drizzle-orm';
import { DB, type DrizzleDb } from '../db/db.module.js';
import { chatMessages, type ChatMessageRow } from '../db/schema.js';
import type { StoredMessage, MessagePart, MessageStatus, SenderType } from './chat.types.js';

export const CHAT_MESSAGES_REPOSITORY = Symbol('CHAT_MESSAGES_REPOSITORY');

export interface AppendAssistantInput {
  readonly threadId: string;
  readonly langgraphId: string | null;
  readonly status: MessageStatus;
  readonly parts: MessagePart[];
  readonly modelName: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly reasoningTokens: number | null;
  readonly latencyMs: number | null;
  readonly runId: string | null;
}

export interface ChatMessagesRepository {
  appendUser(threadId: string, text: string): Promise<ChatMessageRow>;
  appendAssistant(input: AppendAssistantInput): Promise<ChatMessageRow | null>;
  listByThread(threadId: string): Promise<ChatMessageRow[]>;
  deleteByThread(threadId: string): Promise<void>;
}

export function toStoredMessage(row: ChatMessageRow): StoredMessage {
  const tokenCount =
    row.inputTokens === null && row.outputTokens === null
      ? null
      : (row.inputTokens ?? 0) + (row.outputTokens ?? 0);

  return {
    id: row.langgraphId ?? `seq-${row.seq}`,
    sessionId: row.threadId,
    createdAt: row.createdAt ? new Date(row.createdAt).getTime() : Date.now(),
    seq: row.seq,
    senderType: row.role as SenderType,
    content: (row.parts as MessagePart[]) ?? [],
    status: row.status as MessageStatus,
    tokenCount,
    modelName: row.modelName,
    latencyMs: row.latencyMs,
  };
}

@Injectable()
export class DrizzleChatMessagesRepository implements ChatMessagesRepository {
  constructor(@Inject(DB) private readonly db: DrizzleDb) {}

  async appendUser(threadId: string, text: string): Promise<ChatMessageRow> {
    const [inserted] = await this.db
      .insert(chatMessages)
      .values({
        threadId,
        role: 'user',
        status: 'complete',
        parts: [{ type: 'text', text }],
      })
      .returning();
    return inserted;
  }

  async appendAssistant(input: AppendAssistantInput): Promise<ChatMessageRow | null> {
    const [inserted] = await this.db
      .insert(chatMessages)
      .values({
        threadId: input.threadId,
        langgraphId: input.langgraphId,
        role: 'assistant',
        status: input.status,
        parts: input.parts,
        modelName: input.modelName,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        reasoningTokens: input.reasoningTokens,
        latencyMs: input.latencyMs,
        runId: input.runId,
      })
      .onConflictDoNothing()
      .returning();
    return inserted ?? null;
  }

  async listByThread(threadId: string): Promise<ChatMessageRow[]> {
    return this.db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.threadId, threadId))
      .orderBy(asc(chatMessages.seq));
  }

  async deleteByThread(threadId: string): Promise<void> {
    await this.db.delete(chatMessages).where(eq(chatMessages.threadId, threadId));
  }
}
