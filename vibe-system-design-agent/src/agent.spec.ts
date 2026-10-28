const createDeepAgentMock = vi.hoisted(() => vi.fn());
const chatOpenAIMock = vi.hoisted(() => vi.fn());

vi.mock('deepagents', () => ({ createDeepAgent: createDeepAgentMock }));
vi.mock('@langchain/openai', () => ({ ChatOpenAI: chatOpenAIMock }));

describe('agent graph', () => {
  beforeEach(() => {
    vi.resetModules();
    createDeepAgentMock.mockClear();
    chatOpenAIMock.mockClear();
    vi.stubEnv('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1');
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-test');
    vi.stubEnv('OPENROUTER_DEFAULT_MODEL', 'openai/gpt-4o-mini');
  });

  it('builds a deep agent with the fixed system prompt and no checkpointer', async () => {
    const modelInstance = { mocked: 'model' };
    // Vitest 4 rejects arrow implementations for mocks invoked with `new`; a
    // plain constructible function returns the instance instead.
    chatOpenAIMock.mockImplementation(function () {
      return modelInstance;
    });
    await import('./agent.js');
    expect(chatOpenAIMock).toHaveBeenCalledWith({
      model: 'openai/gpt-4o-mini',
      apiKey: 'sk-test',
      configuration: { baseURL: 'https://openrouter.ai/api/v1' },
    });
    expect(createDeepAgentMock).toHaveBeenCalledTimes(1);
    const options = createDeepAgentMock.mock.calls[0][0];
    expect(options.name).toBe('vibe-system-design');
    expect(options.systemPrompt).toBe(
      'You are a friendly, concise assistant. Chat naturally with the user and keep answers short.',
    );
    expect(options.model).toEqual({ mocked: 'model' });
    expect(options).not.toHaveProperty('checkpointer');
  });
});
