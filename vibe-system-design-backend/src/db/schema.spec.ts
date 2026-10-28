import { AI_CHAT_SCHEMA } from './schema.js';

describe('chat schema', () => {
  it('keeps the ai chat schema name constant', () => {
    expect(AI_CHAT_SCHEMA).toBe('vibe_system_design_ai_chat');
  });
});
