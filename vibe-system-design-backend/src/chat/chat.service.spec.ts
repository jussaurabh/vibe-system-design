import { HumanMessage } from '@langchain/core/messages';
import type { ProtocolEvent } from '@langchain/langgraph';

import { ChatService } from './chat.service.js';

function stubAgent(events: ProtocolEvent[]) {
  return {
    streamEvents: vi.fn().mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        for (const event of events) yield event;
      },
    }),
  };
}

describe('ChatService', () => {
  it('streams v3 events with hardcoded ids in configurable and forwards the abort signal', async () => {
    const event = {
      type: 'event',
      seq: 1,
      method: 'messages',
      params: { namespace: [], timestamp: 0, data: { event: 'message-start' } },
    } as ProtocolEvent;
    const streamEvents = vi.fn().mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        yield event;
      },
    });
    const service = new ChatService({ streamEvents });
    const signal = new AbortController().signal;

    const received: ProtocolEvent[] = [];
    for await (const e of service.stream([new HumanMessage('hi')], signal)) received.push(e);

    expect(received).toEqual([event]);
    expect(streamEvents).toHaveBeenCalledWith(
      { messages: [expect.any(HumanMessage)] },
      {
        version: 'v3',
        configurable: {
          thread_id: 'thread-local-dev',
          user_id: 'user-local-dev',
          session_id: 'session-local-dev',
        },
        signal,
      },
    );
  });

  it('forwards only allow-listed events and keeps the payload untouched', async () => {
    const allowedEvent = {
      type: 'event',
      seq: 1,
      method: 'messages',
      params: {
        namespace: [],
        timestamp: 0,
        data: { event: 'content-block-delta', delta: { type: 'text-delta', text: 'hi' } },
      },
    } as ProtocolEvent;
    const blockedEvent = {
      type: 'event',
      seq: 2,
      method: 'values',
      params: { namespace: [], timestamp: 1, data: { messages: [] } },
    } as ProtocolEvent;
    const service = new ChatService(stubAgent([allowedEvent, blockedEvent]));

    const received: ProtocolEvent[] = [];
    for await (const event of service.stream([new HumanMessage('hi')], new AbortController().signal)) {
      received.push(event);
    }

    expect(received).toEqual([allowedEvent]);
    expect(received[0]).toBe(allowedEvent);
  });

  it('forwards an event added through the STREAM_EVENTS env override', async () => {
    const previous = process.env.STREAM_EVENTS;
    process.env.STREAM_EVENTS = 'custom:audit';
    try {
      const auditEvent = {
        type: 'event',
        seq: 1,
        method: 'custom:audit',
        params: { namespace: [], timestamp: 0, data: { note: 'x' } },
      } as ProtocolEvent;
      const service = new ChatService(stubAgent([auditEvent]));

      const received: ProtocolEvent[] = [];
      for await (const event of service.stream([new HumanMessage('hi')], new AbortController().signal)) {
        received.push(event);
      }

      expect(received).toEqual([auditEvent]);
    } finally {
      if (previous === undefined) delete process.env.STREAM_EVENTS;
      else process.env.STREAM_EVENTS = previous;
    }
  });
});
