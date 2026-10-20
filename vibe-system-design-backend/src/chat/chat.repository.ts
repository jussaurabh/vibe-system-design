import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import type { DrizzleDb } from '../db/db.client.js';
import { chatMessages, chatSessions, type MessagePart, type MessageStatus, type SenderType } from '../db/schema.js';
import type { SessionSummary, StoredMessage } from './chat.types.js';

export const CHAT_REPOSITORY = Symbol('CHAT_REPOSITORY');

export interface NewMessage {
  readonly id: string;
  readonly sessionId: string;
  readonly senderType: SenderType;
  readonly content: MessagePart[];
  readonly status: MessageStatus;
  readonly tokenCount: number | null;
  readonly modelName: string | null;
  readonly latencyMs: number | null;
  readonly createdAt: number;
}

export interface ChatRepository {
  listSessions(userId: string): Promise<SessionSummary[]>;
  createSession(userId: string, id: string, now: number): Promise<SessionSummary>;
  getSession(userId: string, sessionId: string): Promise<SessionSummary | null>;
  renameSession(userId: string, sessionId: string, title: string): Promise<boolean>;
  deleteSession(userId: string, sessionId: string): Promise<boolean>;
  listMessages(sessionId: string): Promise<StoredMessage[]>;
  appendMessage(input: NewMessage): Promise<StoredMessage>;
  deleteMessage(userId: string, messageId: string): Promise<boolean>;
}

function toSessionSummary(row: typeof chatSessions.$inferSelect): SessionSummary {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastMessageAt: row.lastMessageAt,
  };
}

function toStoredMessage(row: typeof chatMessages.$inferSelect): StoredMessage {
  return {
    id: row.id,
    sessionId: row.sessionId,
    createdAt: row.createdAt,
    seq: row.seq,
    senderType: row.senderType,
    content: row.content,
    status: row.status,
    tokenCount: row.tokenCount,
    modelName: row.modelName,
    latencyMs: row.latencyMs,
  };
}

export class DrizzleChatRepository implements ChatRepository {
  constructor(private readonly db: DrizzleDb) {}

  async listSessions(userId: string): Promise<SessionSummary[]> {
    const rows = await this.db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.userId, userId))
      .orderBy(
        desc(sql`coalesce(${chatSessions.lastMessageAt}, ${chatSessions.createdAt})`),
        desc(chatSessions.id),
      );
    return rows.map(toSessionSummary);
  }

  async createSession(userId: string, id: string, now: number): Promise<SessionSummary> {
    const [row] = await this.db
      .insert(chatSessions)
      .values({ id, userId, title: '', createdAt: now, updatedAt: now, lastMessageAt: null })
      .returning();
    return toSessionSummary(row);
  }

  async getSession(userId: string, sessionId: string): Promise<SessionSummary | null> {
    const [row] = await this.db
      .select()
      .from(chatSessions)
      .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)))
      .limit(1);
    return row ? toSessionSummary(row) : null;
  }

  async renameSession(userId: string, sessionId: string, title: string): Promise<boolean> {
    const rows = await this.db
      .update(chatSessions)
      .set({ title })
      .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)))
      .returning({ id: chatSessions.id });
    return rows.length > 0;
  }

  async deleteSession(userId: string, sessionId: string): Promise<boolean> {
    const rows = await this.db
      .delete(chatSessions)
      .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)))
      .returning({ id: chatSessions.id });
    return rows.length > 0;
  }

  async listMessages(sessionId: string): Promise<StoredMessage[]> {
    const rows = await this.db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(chatMessages.seq);
    return rows.map(toStoredMessage);
  }

  async appendMessage(input: NewMessage): Promise<StoredMessage> {
    return this.db.transaction(async (tx) => {
      // The seq is the largest seq of the session plus one. Never the row
      // count: a deleted message leaves a hole, and the count would hand out
      // a seq that already exists.
      const [row] = await tx
        .select({ next: sql<number>`coalesce(max(${chatMessages.seq}), 0) + 1` })
        .from(chatMessages)
        .where(eq(chatMessages.sessionId, input.sessionId));

      const seq = Number(row?.next ?? 1);

      const [inserted] = await tx
        .insert(chatMessages)
        .values({
          id: input.id,
          sessionId: input.sessionId,
          createdAt: input.createdAt,
          seq,
          senderType: input.senderType,
          content: input.content,
          status: input.status,
          tokenCount: input.tokenCount,
          modelName: input.modelName,
          latencyMs: input.latencyMs,
        })
        .returning();

      await tx
        .update(chatSessions)
        .set({ lastMessageAt: input.createdAt, updatedAt: input.createdAt })
        .where(eq(chatSessions.id, input.sessionId));

      return toStoredMessage(inserted);
    });
  }

  async deleteMessage(userId: string, messageId: string): Promise<boolean> {
    const owned = this.db
      .select({ id: chatSessions.id })
      .from(chatSessions)
      .where(eq(chatSessions.userId, userId));
    const rows = await this.db
      .delete(chatMessages)
      .where(and(eq(chatMessages.id, messageId), inArray(chatMessages.sessionId, owned)))
      .returning({ id: chatMessages.id });
    return rows.length > 0;
  }
}
