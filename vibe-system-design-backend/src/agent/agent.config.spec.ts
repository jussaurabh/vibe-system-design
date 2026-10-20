import { AgentConfigError, loadAgentConfig } from './agent.config.js';

const completeEnv = {
  OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
  OPENROUTER_API_KEY: 'sk-test',
  OPENROUTER_DEFAULT_MODEL: 'openai/gpt-4.1-mini',
};

describe('loadAgentConfig', () => {
  it('maps env vars to AgentConfig', () => {
    expect(loadAgentConfig(completeEnv)).toEqual({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-test',
      model: 'openai/gpt-4.1-mini',
    });
  });

  it('throws AgentConfigError naming every missing variable', () => {
    expect(() => loadAgentConfig({ OPENROUTER_API_KEY: 'sk-test' })).toThrow(AgentConfigError);
    expect(() => loadAgentConfig({ OPENROUTER_API_KEY: 'sk-test' })).toThrow(
      /OPENROUTER_BASE_URL.*OPENROUTER_DEFAULT_MODEL/,
    );
  });
});
