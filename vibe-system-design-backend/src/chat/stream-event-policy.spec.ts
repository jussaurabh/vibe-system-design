import type { ProtocolEvent } from '@langchain/langgraph';
import { describe, expect, it } from 'vitest';

import { isEventEnabled } from './stream-event-filter.js';
import {
  BASE_EVENT_SELECTORS,
  parseEventSelectorTokens,
  resolveEventSelectors,
} from './stream-event-policy.js';

function event(method: string, data: unknown): ProtocolEvent {
  return {
    type: 'event',
    seq: 0,
    method,
    params: { namespace: [], timestamp: 0, data },
  } as ProtocolEvent;
}

function allowed(method: string, data: unknown, selectors = BASE_EVENT_SELECTORS): boolean {
  return isEventEnabled(event(method, data), selectors);
}

describe('stream event policy', () => {
  it('allows the base protocol events the UI needs', () => {
    expect(allowed('messages', { event: 'message-start' })).toBe(true);
    expect(allowed('messages', { event: 'content-block-start' })).toBe(true);
    expect(allowed('messages', { event: 'content-block-delta' })).toBe(true);
    expect(allowed('messages', { event: 'content-block-finish' })).toBe(true);
    expect(allowed('messages', { event: 'message-finish' })).toBe(true);
    expect(allowed('messages', { event: 'usage' })).toBe(true);
    expect(allowed('messages', { event: 'provider' })).toBe(true);
    expect(allowed('messages', { event: 'error' })).toBe(true);
    expect(allowed('updates', { node: 'model_request' })).toBe(true);
    expect(allowed('tasks', { id: 't1', input: {} })).toBe(true);
    expect(allowed('tasks', { id: 't1', result: {} })).toBe(true);
    expect(allowed('tasks', { id: 't1', interrupts: [] })).toBe(true);
    expect(allowed('lifecycle', { event: 'running' })).toBe(true);
    expect(allowed('lifecycle', { event: 'started' })).toBe(true);
    expect(allowed('lifecycle', { event: 'completed' })).toBe(true);
    expect(allowed('lifecycle', { event: 'error' })).toBe(true);
    expect(allowed('tools', { event: 'tool-started' })).toBe(true);
  });

  it('blocks every method and event that is not on the base list', () => {
    expect(allowed('values', { messages: [] })).toBe(false);
    expect(allowed('checkpoints', { id: 'c1' })).toBe(false);
    expect(allowed('input', { messages: [] })).toBe(false);
    expect(allowed('messages', { event: 'some-unknown-event' })).toBe(false);
  });

  it('parses env tokens into selectors', () => {
    expect(parseEventSelectorTokens('updates, messages/message-start')).toEqual([
      { method: 'updates' },
      { method: 'messages', event: 'message-start' },
    ]);
  });

  it('ignores blank and malformed env tokens', () => {
    expect(parseEventSelectorTokens(' , , /message-start , messages/ , ')).toEqual([]);
  });

  it('unions the env override on top of the base list', () => {
    const selectors = resolveEventSelectors({ STREAM_EVENTS: 'custom:audit' } as NodeJS.ProcessEnv);
    expect(isEventEnabled(event('custom:audit', { note: 'x' }), selectors)).toBe(true);
    expect(isEventEnabled(event('messages', { event: 'content-block-delta' }), selectors)).toBe(true);
    expect(isEventEnabled(event('values', { messages: [] }), selectors)).toBe(false);
  });

  it('returns the base list when the env var is absent', () => {
    expect(resolveEventSelectors({} as NodeJS.ProcessEnv)).toEqual(BASE_EVENT_SELECTORS);
  });
});
