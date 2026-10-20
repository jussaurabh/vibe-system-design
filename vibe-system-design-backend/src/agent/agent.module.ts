import { Module } from '@nestjs/common';

import { type AgentConfig, loadAgentConfig } from './agent.config.js';
import { AGENT_CONFIG, createStreamableAgent, DEEP_AGENT } from './agent.provider.js';

@Module({
  providers: [
    { provide: AGENT_CONFIG, useFactory: () => loadAgentConfig() },
    {
      provide: DEEP_AGENT,
      useFactory: (config: AgentConfig) => createStreamableAgent(config),
      inject: [AGENT_CONFIG],
    },
  ],
  exports: [DEEP_AGENT],
})
export class AgentModule {}
