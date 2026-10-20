import type { ProtocolEvent } from '@langchain/langgraph';

export interface EventSelector {
  readonly method: string;
  readonly event?: string;
  readonly dataKey?: string;
}

function asObject(data: unknown): Record<string, unknown> | undefined {
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return undefined;
}

export function readEventName(event: ProtocolEvent): string | undefined {
  const data = asObject(event.params.data);
  if (data === undefined) return undefined;
  const name = data['event'];
  return typeof name === 'string' ? name : undefined;
}

export function readDataKeys(event: ProtocolEvent): string[] {
  const data = asObject(event.params.data);
  return data === undefined ? [] : Object.keys(data);
}

export function matchesSelector(event: ProtocolEvent, selector: EventSelector): boolean {
  if (event.method !== selector.method) return false;
  if (selector.event !== undefined && readEventName(event) !== selector.event) return false;
  if (selector.dataKey !== undefined && !readDataKeys(event).includes(selector.dataKey)) return false;
  return true;
}

export function isEventEnabled(event: ProtocolEvent, selectors: readonly EventSelector[]): boolean {
  return selectors.some((selector) => matchesSelector(event, selector));
}

export function createEventFilter(selectors: readonly EventSelector[]): (event: ProtocolEvent) => boolean {
  return (event) => isEventEnabled(event, selectors);
}
