import type { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

import { createStreamableAgent } from './agent.provider.js';

const createDeepAgentMock = vi.hoisted(() => vi.fn());
const chatOpenAIMock = vi.hoisted(() => vi.fn());

vi.mock('deepagents', () => ({ createDeepAgent: createDeepAgentMock }));
vi.mock('@langchain/openai', () => ({ ChatOpenAI: chatOpenAIMock }));

const config = {
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: 'sk-test',
  model: 'openai/gpt-4.1-mini',
};

const checkpointer = {} as PostgresSaver;

describe('createStreamableAgent', () => {
  it('builds ChatOpenAI on the OpenRouter base URL and hands it to createDeepAgent', () => {
    const modelInstance = { tag: 'model' };
    // Vitest 4 rejects `mockReturnValue` for mocks invoked with `new`; a plain
    // constructible function returns the instance instead.
    chatOpenAIMock.mockImplementation(function () {
      return modelInstance;
    });
    createDeepAgentMock.mockReturnValue({ streamEvents: vi.fn() });

    createStreamableAgent(config, checkpointer);

    expect(chatOpenAIMock).toHaveBeenCalledWith({
      model: 'openai/gpt-4.1-mini',
      apiKey: 'sk-test',
      configuration: { baseURL: 'https://openrouter.ai/api/v1' },
    });
    expect(createDeepAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: modelInstance,
        name: 'vibe-system-design',
        systemPrompt:
          'You are a friendly, concise assistant. Chat naturally with the user and keep answers short.',
      }),
    );
    const deepAgentOptions = createDeepAgentMock.mock.calls.at(-1)?.[0];
    expect(deepAgentOptions?.checkpointer).toBe(checkpointer);
  });

  it('delegates streamEvents to the deep agent unchanged', async () => {
    const fakeRun = { [Symbol.asyncIterator]: async function* () {} };
    const inner = vi.fn().mockResolvedValue(fakeRun);
    createDeepAgentMock.mockReturnValue({ streamEvents: inner });
    const agent = createStreamableAgent(config, checkpointer);
    const signal = new AbortController().signal;
    const cfg = {
      version: 'v3' as const,
      configurable: { thread_id: 't' },
      signal,
    };

    await expect(agent.streamEvents({ messages: [] }, cfg)).resolves.toBe(
      fakeRun,
    );
    expect(inner).toHaveBeenCalledWith({ messages: [] }, cfg);
    expect(createDeepAgentMock.mock.calls.at(-1)?.[0].checkpointer).toBe(
      checkpointer,
    );
  });
});
