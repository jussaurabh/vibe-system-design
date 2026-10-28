import { loadAgentRuntimeConfig } from './config.js';

describe('loadAgentRuntimeConfig', () => {
  it('reads the three OPENROUTER vars', () => {
    const config = loadAgentRuntimeConfig({
      OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
      OPENROUTER_API_KEY: 'sk-test',
      OPENROUTER_DEFAULT_MODEL: 'openai/gpt-4o-mini',
    });
    expect(config).toEqual({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-test',
      model: 'openai/gpt-4o-mini',
    });
  });

  it.each(['OPENROUTER_BASE_URL', 'OPENROUTER_API_KEY', 'OPENROUTER_DEFAULT_MODEL'])(
    'throws naming the first missing var (%s)',
    (missing) => {
      const env: Record<string, string> = {
        OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
        OPENROUTER_API_KEY: 'sk-test',
        OPENROUTER_DEFAULT_MODEL: 'openai/gpt-4o-mini',
      };
      delete env[missing];
      expect(() => loadAgentRuntimeConfig(env)).toThrow(missing);
    },
  );
});
