import type { ProtocolEvent } from '@langchain/langgraph';
import { describe, expect, it } from 'vitest';

import {
  createEventFilter,
  isEventEnabled,
  matchesSelector,
  readDataKeys,
  readEventName,
  type EventSelector,
} from './stream-event-filter.js';

function event(method: string, data: unknown): ProtocolEvent {
  return {
    type: 'event',
    seq: 0,
    method,
    params: { namespace: [], timestamp: 0, data },
  } as ProtocolEvent;
}

describe('stream event filter', () => {
  it('reads the event name from the payload and reports no name when there is none', () => {
    expect(readEventName(event('messages', { event: 'content-block-delta' }))).toBe('content-block-delta');
    expect(readEventName(event('updates', { node: 'model_request' }))).toBeUndefined();
  });

  it('reads the payload keys and returns no keys for a payload that is not an object', () => {
    expect(readDataKeys(event('tasks', { id: 't1', result: {} }))).toEqual(['id', 'result']);
    expect(readDataKeys(event('messages', null))).toEqual([]);
    expect(readDataKeys(event('messages', 'oops'))).toEqual([]);
  });

  it('matches a selector on method alone', () => {
    const selector: EventSelector = { method: 'updates' };
    expect(matchesSelector(event('updates', { node: 'a' }), selector)).toBe(true);
    expect(matchesSelector(event('values', { messages: [] }), selector)).toBe(false);
  });

  it('matches a selector on method and event name', () => {
    const selector: EventSelector = { method: 'messages', event: 'content-block-delta' };
    expect(matchesSelector(event('messages', { event: 'content-block-delta' }), selector)).toBe(true);
    expect(matchesSelector(event('messages', { event: 'message-start' }), selector)).toBe(false);
    expect(matchesSelector(event('messages', { delta: {} }), selector)).toBe(false);
  });

  it('matches a selector on method and payload key', () => {
    const selector: EventSelector = { method: 'tasks', dataKey: 'interrupts' };
    expect(matchesSelector(event('tasks', { id: 't1', interrupts: [] }), selector)).toBe(true);
    expect(matchesSelector(event('tasks', { id: 't1', result: {} }), selector)).toBe(false);
  });

  it('matches an unknown event name without rejecting it', () => {
    const selector: EventSelector = { method: 'messages', event: 'usage' };
    expect(matchesSelector(event('messages', { event: 'usage', usage: {} }), selector)).toBe(true);
  });

  it('matches regardless of the namespace the event came from', () => {
    const selector: EventSelector = { method: 'lifecycle', event: 'started' };
    const nested = {
      type: 'event',
      seq: 0,
      method: 'lifecycle',
      params: {
        namespace: ['model_request:7e42e895'],
        timestamp: 0,
        data: { event: 'started', graph_name: 'model_request' },
      },
    } as ProtocolEvent;
    expect(matchesSelector(nested, selector)).toBe(true);
  });

  it('enables an event when at least one selector matches', () => {
    const selectors: EventSelector[] = [
      { method: 'messages', event: 'content-block-delta' },
      { method: 'lifecycle', event: 'running' },
    ];
    expect(isEventEnabled(event('messages', { event: 'content-block-delta' }), selectors)).toBe(true);
    expect(isEventEnabled(event('lifecycle', { event: 'running' }), selectors)).toBe(true);
    expect(isEventEnabled(event('values', { messages: [] }), selectors)).toBe(false);
  });

  it('enables nothing when the selector list is empty', () => {
    expect(isEventEnabled(event('messages', { event: 'content-block-delta' }), [])).toBe(false);
  });

  it('builds a predicate that blocks a payload that is not an object', () => {
    const isEnabled = createEventFilter([{ method: 'messages', event: 'content-block-delta' }]);
    expect(isEnabled(event('messages', { event: 'content-block-delta' }))).toBe(true);
    expect(isEnabled(event('messages', undefined))).toBe(false);
  });
});
