import { loadAgentServerConfig } from './agent-server.config.js';

const completeEnv = {
  AGENT_SERVER_URL: 'http://localhost:2024',
  AGENT_SERVER_API_KEY: 'test-key',
};

describe('loadAgentServerConfig', () => {
  it('maps env vars to AgentServerConfig', () => {
    expect(loadAgentServerConfig(completeEnv)).toEqual({
      apiUrl: 'http://localhost:2024',
      apiKey: 'test-key',
    });
  });

  it('throws naming AGENT_SERVER_URL when it is missing', () => {
    expect(() => loadAgentServerConfig({ AGENT_SERVER_API_KEY: 'test-key' })).toThrow(
      'Missing required env var AGENT_SERVER_URL',
    );
  });

  it('leaves apiKey undefined and does not throw when AGENT_SERVER_API_KEY is unset', () => {
    const config = loadAgentServerConfig({ AGENT_SERVER_URL: 'http://localhost:2024' });

    expect(config.apiKey).toBeUndefined();
  });
});
