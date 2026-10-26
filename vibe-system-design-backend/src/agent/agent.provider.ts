import type { BaseMessage } from '@langchain/core/messages';
import type { ProtocolEvent } from '@langchain/langgraph';
import type { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { ChatOpenAI } from '@langchain/openai';
import { createDeepAgent } from 'deepagents';

import type { AgentConfig } from './agent.config.js';

export const DEEP_AGENT = Symbol('DEEP_AGENT');
export const AGENT_CONFIG = Symbol('AGENT_CONFIG');

export interface StreamableAgent {
  /** The name of the model behind the agent. The chat stores it on a row. */
  readonly modelName?: string;
  streamEvents(
    input: { messages: BaseMessage[] },
    config: {
      version: 'v3';
      configurable: Record<string, string>;
      signal: AbortSignal;
    },
  ): Promise<AsyncIterable<ProtocolEvent>>;
}

const SYSTEM_PROMPT =
  'You are a friendly, concise assistant. Chat naturally with the user and keep answers short.';

export function createStreamableAgent(
  config: AgentConfig,
  checkpointer: PostgresSaver,
): StreamableAgent {
  const model = new ChatOpenAI({
    model: config.model,
    apiKey: config.apiKey,
    configuration: { baseURL: config.baseURL },
  });

  const deepAgent = createDeepAgent({
    model,
    name: 'vibe-system-design',
    systemPrompt: SYSTEM_PROMPT,
    checkpointer,
  });

  const streamEvents: StreamableAgent['streamEvents'] = async (input, cfg) =>
    deepAgent.streamEvents(input, cfg);

  return { modelName: config.model, streamEvents };
}
