import type { EventSelector } from './stream-event-filter.js';

export const STREAM_EVENTS_ENV_VAR = 'STREAM_EVENTS';

export const BASE_EVENT_SELECTORS: readonly EventSelector[] = [
  { method: 'messages', event: 'message-start' },
  { method: 'messages', event: 'content-block-start' },
  { method: 'messages', event: 'content-block-delta' },
  { method: 'messages', event: 'content-block-finish' },
  { method: 'messages', event: 'message-finish' },
  { method: 'messages', event: 'usage' },
  { method: 'messages', event: 'provider' },
  { method: 'messages', event: 'error' },
  { method: 'updates' },
  { method: 'tasks', dataKey: 'input' },
  { method: 'tasks', dataKey: 'result' },
  { method: 'tasks', dataKey: 'interrupts' },
  { method: 'lifecycle', event: 'running' },
  { method: 'lifecycle', event: 'started' },
  { method: 'lifecycle', event: 'completed' },
  { method: 'lifecycle', event: 'error' },
  { method: 'tools' },
];

export function parseEventSelectorTokens(tokens: string): EventSelector[] {
  return tokens
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((token): EventSelector | undefined => {
      const slash = token.indexOf('/');
      if (slash === -1) {
        return { method: token };
      }
      const method = token.slice(0, slash).trim();
      const event = token.slice(slash + 1).trim();
      if (method.length === 0 || event.length === 0) return undefined;
      return { method, event };
    })
    .filter((selector): selector is EventSelector => selector !== undefined);
}

export function resolveEventSelectors(env: NodeJS.ProcessEnv = process.env): EventSelector[] {
  const extra = parseEventSelectorTokens(env[STREAM_EVENTS_ENV_VAR] ?? '');
  return [...BASE_EVENT_SELECTORS, ...extra];
}
