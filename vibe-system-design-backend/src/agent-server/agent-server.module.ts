import { Client } from '@langchain/langgraph-sdk';
import { Module, type Provider } from '@nestjs/common';

import { AGENT_SERVER_CONFIG, loadAgentServerConfig } from './agent-server.config.js';
import type { AgentServerConfig } from './agent-server.config.js';

export const AGENT_SERVER_CLIENT = Symbol('AGENT_SERVER_CLIENT');

const AGENT_SERVER_CONFIG_PROVIDER: Provider = {
  provide: AGENT_SERVER_CONFIG,
  useFactory: () => loadAgentServerConfig(),
};

const AGENT_SERVER_CLIENT_PROVIDER: Provider = {
  provide: AGENT_SERVER_CLIENT,
  useFactory: (config: AgentServerConfig) =>
    new Client({ apiUrl: config.apiUrl, apiKey: config.apiKey }),
  inject: [AGENT_SERVER_CONFIG],
};

@Module({
  providers: [AGENT_SERVER_CONFIG_PROVIDER, AGENT_SERVER_CLIENT_PROVIDER],
  // The config rides along: the raw cancel request of the chat service
  // reads the API URL and the API key from it.
  exports: [AGENT_SERVER_CONFIG, AGENT_SERVER_CLIENT],
})
export class AgentServerModule {}
