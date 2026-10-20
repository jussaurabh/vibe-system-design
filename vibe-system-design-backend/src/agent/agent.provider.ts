import type { BaseMessage } from '@langchain/core/messages';
import type { ProtocolEvent } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { createDeepAgent } from 'deepagents';

import type { AgentConfig } from './agent.config.js';

export const DEEP_AGENT = Symbol('DEEP_AGENT');
export const AGENT_CONFIG = Symbol('AGENT_CONFIG');

export interface StreamableAgent {
  streamEvents(
    input: { messages: BaseMessage[] },
    config: { version: 'v3'; configurable: Record<string, string>; signal: AbortSignal },
  ): Promise<AsyncIterable<ProtocolEvent>>;
}

const SYSTEM_PROMPT =
  'You are a friendly, concise assistant. Chat naturally with the user and keep answers short.';

export function createStreamableAgent(config: AgentConfig): StreamableAgent {
  const model = new ChatOpenAI({
    model: config.model,
    apiKey: config.apiKey,
    configuration: { baseURL: config.baseURL },
  });

  const deepAgent = createDeepAgent({
    model,
    name: 'vibe-system-design',
    systemPrompt: SYSTEM_PROMPT,
  });

  const streamEvents: StreamableAgent['streamEvents'] = async (input, cfg) =>
    deepAgent.streamEvents(input, cfg);

  return { streamEvents };
}
