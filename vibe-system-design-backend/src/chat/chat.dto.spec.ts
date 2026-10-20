import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { chatStreamRequestSchema, toLangChainMessages } from './chat.dto.js';

describe('chatStreamRequestSchema', () => {
  it('accepts a user message', () => {
    const parsed = chatStreamRequestSchema.safeParse({
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an empty messages array', () => {
    expect(chatStreamRequestSchema.safeParse({ messages: [] }).success).toBe(false);
  });

  it('rejects an unknown role', () => {
    expect(
      chatStreamRequestSchema.safeParse({ messages: [{ role: 'tool', content: 'x' }] }).success,
    ).toBe(false);
  });

  it('rejects messages that are not an array', () => {
    expect(chatStreamRequestSchema.safeParse({ messages: 'hi' }).success).toBe(false);
  });
});

describe('toLangChainMessages', () => {
  it('maps each role to its LangChain message class', () => {
    const mapped = toLangChainMessages([
      { role: 'system', content: 'be nice' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
    expect(mapped[0]).toBeInstanceOf(SystemMessage);
    expect(mapped[1]).toBeInstanceOf(HumanMessage);
    expect(mapped[2]).toBeInstanceOf(AIMessage);
  });

  it('passes through a system-only conversation unchanged', () => {
    expect(toLangChainMessages([{ role: 'system', content: 'be nice' }])).toHaveLength(1);
  });
});
