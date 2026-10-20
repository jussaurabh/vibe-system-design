import { z } from 'zod';

export const chatStreamRequestSchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1),
});

export type ChatStreamRequestDto = z.infer<typeof chatStreamRequestSchema>;

export const sessionSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastMessageAt: z.number().nullable(),
});

export type SessionSummaryDto = z.infer<typeof sessionSummarySchema>;

export const storedMessageSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  createdAt: z.number(),
  seq: z.number(),
  senderType: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.array(z.unknown()),
  status: z.enum(['complete', 'incomplete', 'error']),
  tokenCount: z.number().nullable(),
  modelName: z.string().nullable(),
  latencyMs: z.number().nullable(),
});

export type StoredMessageDto = z.infer<typeof storedMessageSchema>;

export const renameSessionBodySchema = z.object({
  title: z.string().min(1).max(120),
});

export type RenameSessionBodyDto = z.infer<typeof renameSessionBodySchema>;
