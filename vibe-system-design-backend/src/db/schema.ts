export const AI_CHAT_SCHEMA = 'vibe_system_design_ai_chat';

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
