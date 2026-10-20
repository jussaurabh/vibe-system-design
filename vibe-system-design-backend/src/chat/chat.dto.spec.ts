import {
  chatStreamRequestSchema,
  renameSessionBodySchema,
  sessionSummarySchema,
  storedMessageSchema,
} from './chat.dto.js';

describe('chatStreamRequestSchema', () => {
  it('accepts a session id and a message', () => {
    const parsed = chatStreamRequestSchema.safeParse({ sessionId: 'ses_test', message: 'hi' });
    expect(parsed.success).toBe(true);
  });

  it('rejects a body without a session id', () => {
    expect(chatStreamRequestSchema.safeParse({ message: 'hi' }).success).toBe(false);
  });

  it('rejects a body without a message', () => {
    expect(chatStreamRequestSchema.safeParse({ sessionId: 'ses_test' }).success).toBe(false);
  });

  it('rejects an empty message', () => {
    expect(chatStreamRequestSchema.safeParse({ sessionId: 'ses_test', message: '' }).success).toBe(false);
  });
});

describe('renameSessionBodySchema', () => {
  it('accepts a title', () => {
    expect(renameSessionBodySchema.safeParse({ title: 'A title' }).success).toBe(true);
  });

  it('rejects an empty title', () => {
    expect(renameSessionBodySchema.safeParse({ title: '' }).success).toBe(false);
  });
});

describe('sessionSummarySchema', () => {
  it('accepts a summary with a null last message time', () => {
    expect(
      sessionSummarySchema.safeParse({
        id: 'ses_test',
        title: '',
        createdAt: 1,
        updatedAt: 1,
        lastMessageAt: null,
      }).success,
    ).toBe(true);
  });
});

describe('storedMessageSchema', () => {
  it('accepts a stored message', () => {
    expect(
      storedMessageSchema.safeParse({
        id: 'msg_test',
        sessionId: 'ses_test',
        createdAt: 1,
        seq: 1,
        senderType: 'user',
        content: [{ type: 'text', text: 'hi' }],
        status: 'complete',
        tokenCount: null,
        modelName: null,
        latencyMs: null,
      }).success,
    ).toBe(true);
  });
});
