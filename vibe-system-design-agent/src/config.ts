export interface AgentRuntimeConfig {
  baseURL: string;
  apiKey: string;
  model: string;
}

export function loadAgentRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): AgentRuntimeConfig {
  const baseURL = env.OPENROUTER_BASE_URL;
  if (!baseURL) {
    throw new Error('Missing required env var OPENROUTER_BASE_URL');
  }

  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('Missing required env var OPENROUTER_API_KEY');
  }

  const model = env.OPENROUTER_DEFAULT_MODEL;
  if (!model) {
    throw new Error('Missing required env var OPENROUTER_DEFAULT_MODEL');
  }

  return { baseURL, apiKey, model };
}
