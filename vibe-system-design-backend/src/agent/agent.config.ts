export interface AgentConfig {
  baseURL: string;
  apiKey: string;
  model: string;
}

export class AgentConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentConfigError';
  }
}

const REQUIRED_KEYS = ['OPENROUTER_BASE_URL', 'OPENROUTER_API_KEY', 'OPENROUTER_DEFAULT_MODEL'] as const;

export function loadAgentConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const missing = REQUIRED_KEYS.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new AgentConfigError(`Missing required env vars: ${missing.join(', ')}`);
  }
  return {
    baseURL: env.OPENROUTER_BASE_URL!,
    apiKey: env.OPENROUTER_API_KEY!,
    model: env.OPENROUTER_DEFAULT_MODEL!,
  };
}
