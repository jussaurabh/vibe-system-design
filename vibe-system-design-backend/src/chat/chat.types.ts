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
