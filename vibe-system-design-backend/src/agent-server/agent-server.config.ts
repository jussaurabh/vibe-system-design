export interface AgentServerConfig {
  readonly apiUrl: string;
  readonly apiKey?: string;
}

export const AGENT_SERVER_CONFIG = Symbol('AGENT_SERVER_CONFIG');

export function loadAgentServerConfig(env: NodeJS.ProcessEnv = process.env): AgentServerConfig {
  const apiUrl = env.AGENT_SERVER_URL;
  if (!apiUrl) {
    throw new Error('Missing required env var AGENT_SERVER_URL');
  }
  return {
    apiUrl,
    apiKey: env.AGENT_SERVER_API_KEY,
  };
}
