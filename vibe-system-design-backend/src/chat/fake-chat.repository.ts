import { HARDCODED_USER_ID } from './chat.constants.js';
import type { ChatRepository, NewMessage } from './chat.repository.js';
import type { SessionSummary, StoredMessage } from './chat.types.js';

/**
 * An in-memory {@link ChatRepository}. The tests use the fake, so the suite
 * needs neither a database nor `DATABASE_URL`.
 */
export class FakeChatRepository implements ChatRepository {
  private readonly sessions = new Map<string, SessionSummary>();
  private readonly owners = new Map<string, string>();
  private readonly messages = new Map<string, StoredMessage[]>();

  async listSessions(userId: string): Promise<SessionSummary[]> {
    return [...this.sessions.values()]
      .filter((session) => this.owners.get(session.id) === userId)
      .sort((a, b) => {
        const left = a.lastMessageAt ?? a.createdAt;
        const right = b.lastMessageAt ?? b.createdAt;
        if (left !== right) return right - left;
        return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
      });
  }

  async createSession(userId: string, id: string, now: number): Promise<SessionSummary> {
    const session: SessionSummary = {
      id,
      title: '',
      createdAt: now,
      updatedAt: now,
      lastMessageAt: null,
    };
    this.sessions.set(id, session);
    this.owners.set(id, userId);
    return session;
  }

  async getSession(userId: string, sessionId: string): Promise<SessionSummary | null> {
    if (this.owners.get(sessionId) !== userId) return null;
    return this.sessions.get(sessionId) ?? null;
  }

  async renameSession(userId: string, sessionId: string, title: string): Promise<boolean> {
    if (this.owners.get(sessionId) !== userId) return false;
    const session = this.sessions.get(sessionId);
    if (session === undefined) return false;
    this.sessions.set(sessionId, { ...session, title });
    return true;
  }

  async deleteSession(userId: string, sessionId: string): Promise<boolean> {
    if (this.owners.get(sessionId) !== userId) return false;
    this.sessions.delete(sessionId);
    this.owners.delete(sessionId);
    this.messages.delete(sessionId);
    return true;
  }

  async listMessages(sessionId: string): Promise<StoredMessage[]> {
    return [...(this.messages.get(sessionId) ?? [])].sort((a, b) => a.seq - b.seq);
  }

  async appendMessage(input: NewMessage): Promise<StoredMessage> {
    const rows = this.messages.get(input.sessionId) ?? [];
    const seq = rows.reduce((max, row) => (row.seq > max ? row.seq : max), 0) + 1;
    const stored: StoredMessage = {
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
    };
    this.messages.set(input.sessionId, [...rows, stored]);

    const session = this.sessions.get(input.sessionId);
    if (session !== undefined) {
      this.sessions.set(input.sessionId, {
        ...session,
        lastMessageAt: input.createdAt,
        updatedAt: input.createdAt,
      });
    }
    return stored;
  }

  async deleteMessage(userId: string, messageId: string): Promise<boolean> {
    for (const [sessionId, rows] of this.messages) {
      if (this.owners.get(sessionId) !== userId) continue;
      const next = rows.filter((row) => row.id !== messageId);
      if (next.length === rows.length) continue;
      this.messages.set(sessionId, next);
      return true;
    }
    return false;
  }

  /** Add a session that a test prepared. */
  addSession(summary: SessionSummary, userId: string = HARDCODED_USER_ID): void {
    this.sessions.set(summary.id, summary);
    this.owners.set(summary.id, userId);
  }

  /** Add a message that a test prepared. */
  addMessage(message: StoredMessage): void {
    const rows = this.messages.get(message.sessionId) ?? [];
    this.messages.set(message.sessionId, [...rows, message]);
  }

  /** Forget every session and message. */
  reset(): void {
    this.sessions.clear();
    this.owners.clear();
    this.messages.clear();
  }
}
