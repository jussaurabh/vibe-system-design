import { ChatOpenAI } from '@langchain/openai';
import { createDeepAgent } from 'deepagents';

import { loadAgentRuntimeConfig } from './config.js';

export const AGENT_NAME = 'vibe-system-design';

export const SYSTEM_PROMPT =
  'You are a friendly, concise assistant. Chat naturally with the user and keep answers short.';

const config = loadAgentRuntimeConfig();

export const agent = createDeepAgent({
  model: new ChatOpenAI({
    model: config.model,
    apiKey: config.apiKey,
    configuration: { baseURL: config.baseURL },
  }),
  name: AGENT_NAME,
  systemPrompt: SYSTEM_PROMPT,
});
