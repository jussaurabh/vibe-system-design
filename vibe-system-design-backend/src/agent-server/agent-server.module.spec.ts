import { Test } from '@nestjs/testing';
import { Client } from '@langchain/langgraph-sdk';

import { AGENT_SERVER_CLIENT, AgentServerModule } from './agent-server.module.js';

const stubConfig = vi.hoisted(() => ({
  apiUrl: 'http://localhost:2024',
  apiKey: 'test-key',
}));

vi.mock('./agent-server.config.js', () => ({
  AGENT_SERVER_CONFIG: Symbol('AGENT_SERVER_CONFIG'),
  loadAgentServerConfig: () => stubConfig,
}));

describe('AgentServerModule', () => {
  it('exposes AGENT_SERVER_CLIENT as a Client built from the loaded config', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AgentServerModule] }).compile();

    const client = moduleRef.get(AGENT_SERVER_CLIENT);

    expect(client).toBeInstanceOf(Client);
    // SDK 1.12.x keeps the base URL on the sub-clients (BaseClient), not on
    // the Client facade. `apiUrl` is protected there, hence the cast.
    expect((client.threads as unknown as { apiUrl: string }).apiUrl).toBe(stubConfig.apiUrl);
  });
});
