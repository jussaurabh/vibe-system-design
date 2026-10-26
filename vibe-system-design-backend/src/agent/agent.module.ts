import type { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { Module } from '@nestjs/common';

import { CheckpointerModule } from '../checkpointer/checkpointer.module.js';
import { POSTGRES_CHECKPOINTER } from '../checkpointer/checkpointer.provider.js';
import { type AgentConfig, loadAgentConfig } from './agent.config.js';
import {
  AGENT_CONFIG,
  createStreamableAgent,
  DEEP_AGENT,
} from './agent.provider.js';

@Module({
  imports: [CheckpointerModule],
  providers: [
    { provide: AGENT_CONFIG, useFactory: () => loadAgentConfig() },
    {
      provide: DEEP_AGENT,
      useFactory: (config: AgentConfig, checkpointer: PostgresSaver) =>
        createStreamableAgent(config, checkpointer),
      inject: [AGENT_CONFIG, POSTGRES_CHECKPOINTER],
    },
  ],
  exports: [DEEP_AGENT],
})
export class AgentModule {}
