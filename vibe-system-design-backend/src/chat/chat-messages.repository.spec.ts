import { describe, it, expect } from 'vitest';
import { toStoredMessage } from './chat-messages.repository.js';
import type { ChatMessageRow } from '../db/schema.js';

describe('chat-messages.repository', () => {
  describe('toStoredMessage', () => {
    it('maps row fields to StoredMessage correctly', () => {
      const row: ChatMessageRow = {
        seq: 7,
        threadId: '123e4567-e89b-12d3-a456-426614174000',
        langgraphId: 'ai-1',
        role: 'assistant',
        status: 'complete',
        parts: [{ type: 'text', text: 'Hello' }],
        modelName: 'openai/gpt-4',
        inputTokens: 10,
        outputTokens: 5,
        reasoningTokens: 2,
        latencyMs: 120,
        runId: 'run-99',
        createdAt: new Date('2026-11-06T00:00:00Z'),
      };

      const mapped = toStoredMessage(row);

      expect(mapped).toEqual({
        id: 'ai-1',
        sessionId: '123e4567-e89b-12d3-a456-426614174000',
        createdAt: new Date('2026-11-06T00:00:00Z').getTime(),
        seq: 7,
        senderType: 'assistant',
        content: [{ type: 'text', text: 'Hello' }],
        status: 'complete',
        tokenCount: 15,
        modelName: 'openai/gpt-4',
        latencyMs: 120,
      });
    });

    it('falls back to seq-N when langgraphId is null and handles null tokens', () => {
      const row: ChatMessageRow = {
        seq: 4,
        threadId: '123e4567-e89b-12d3-a456-426614174000',
        langgraphId: null,
        role: 'user',
        status: 'complete',
        parts: [{ type: 'text', text: 'Hi' }],
        modelName: null,
        inputTokens: null,
        outputTokens: null,
        reasoningTokens: null,
        latencyMs: null,
        runId: null,
        createdAt: new Date('2026-11-06T00:00:00Z'),
      };

      const mapped = toStoredMessage(row);
      expect(mapped.id).toBe('seq-4');
      expect(mapped.tokenCount).toBeNull();
    });
  });
});
