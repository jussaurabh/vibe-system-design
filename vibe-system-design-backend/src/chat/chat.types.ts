import type { MessagePart, MessageStatus, SenderType } from '../db/schema.js';

/** A session of the chat, as the API returns it. */
export interface SessionSummary {
  readonly id: string;
  readonly title: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly lastMessageAt: number | null;
}

/** A stored message of a session, as the API returns it. */
export interface StoredMessage {
  readonly id: string;
  readonly sessionId: string;
  readonly createdAt: number;
  readonly seq: number;
  readonly senderType: SenderType;
  readonly content: MessagePart[];
  readonly status: MessageStatus;
  readonly tokenCount: number | null;
  readonly modelName: string | null;
  readonly latencyMs: number | null;
}
