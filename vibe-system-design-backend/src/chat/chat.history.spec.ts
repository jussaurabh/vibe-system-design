import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';

import { toLangChainMessages } from './chat.history.js';


describe('toLangChainMessages', () => {
  it('maps the user, assistant, and system rows', () => {
    const messages = toLangChainMessages([
      { id: 'msg_1', sessionId: 'ses_1', createdAt: 1, seq: 1, senderType: 'user', content: [{ type: 'text', text: 'hi' }], status: 'complete', tokenCount: null, modelName: null, latencyMs: null },
      { id: 'msg_2', sessionId: 'ses_1', createdAt: 2, seq: 2, senderType: 'assistant', content: [{ type: 'text', text: 'hello' }], status: 'complete', tokenCount: null, modelName: null, latencyMs: null },
      { id: 'msg_3', sessionId: 'ses_1', createdAt: 3, seq: 3, senderType: 'system', content: [{ type: 'text', text: 'be nice' }], status: 'complete', tokenCount: null, modelName: null, latencyMs: null },
    ]);

    expect(messages[0]).toBeInstanceOf(HumanMessage);
    expect(messages[1]).toBeInstanceOf(AIMessage);
    expect(messages[2]).toBeInstanceOf(SystemMessage);
  });

  it('skips the tool rows', () => {
    const messages = toLangChainMessages([
      { id: 'msg_1', sessionId: 'ses_1', createdAt: 1, seq: 1, senderType: 'tool', content: [{ type: 'tool', toolCallId: 'c', name: 'ls', status: 'complete' }], status: 'complete', tokenCount: null, modelName: null, latencyMs: null },
    ]);
    expect(messages).toEqual([]);
  });
});
