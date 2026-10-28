import type { ProtocolEvent as LanggraphProtocolEvent } from '@langchain/langgraph';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProtocolEvent, UsageInfo } from '../utils/protocol-event.js';
import { ProtocolAdapter } from './protocol-adapter.js';

const TIMESTAMP = 1_700_000_000_000;

describe('ProtocolAdapter', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(TIMESTAMP);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('translates a full messages-tuple message into UI frames (case A)', () => {
    const adapter = new ProtocolAdapter();
    const events = [
      ...adapter.consume({ event: 'metadata', data: { run_id: 'run-1' } }),
      ...adapter.consume({
        event: 'messages',
        data: [{ id: 'ai-1', content: 'Hello' }, { langgraph_node: 'model' }],
      }),
      ...adapter.consume({
        event: 'messages',
        data: [
          {
            id: 'ai-1',
            content: ' world',
            usage_metadata: {
              input_tokens: 5,
              output_tokens: 7,
              total_tokens: 12,
            },
          },
          {},
        ],
      }),
      ...adapter.flush(),
    ];
    expect(events.map((e) => [e.seq, e.method])).toEqual([
      [0, 'lifecycle'],
      [1, 'messages'],
      [2, 'messages'],
      [3, 'messages'],
      [4, 'messages'],
      [5, 'messages'],
      [6, 'messages'],
      [7, 'lifecycle'],
    ]);
    const [
      running,
      start,
      blockStart,
      delta1,
      delta2,
      blockFinish,
      finish,
      completed,
    ] = events;
    expect(running.params.data).toEqual({ event: 'running' });
    expect(start.params.data).toEqual({
      event: 'message-start',
      role: 'assistant',
      id: 'ai-1',
    });
    expect(blockStart.params.data).toEqual({
      event: 'content-block-start',
      index: 0,
      content: { type: 'text', text: '' },
    });
    expect(delta1.params.data).toEqual({
      event: 'content-block-delta',
      index: 0,
      delta: { type: 'text-delta', text: 'Hello' },
    });
    expect(delta2.params.data).toEqual({
      event: 'content-block-delta',
      index: 0,
      delta: { type: 'text-delta', text: ' world' },
    });
    expect(blockFinish.params.data).toEqual({
      event: 'content-block-finish',
      index: 0,
    });
    expect(finish.params.data).toEqual({
      event: 'message-finish',
      usage: { input_tokens: 5, output_tokens: 7, total_tokens: 12 },
    });
    expect(completed.params.data).toEqual({ event: 'completed' });
    for (const e of events) {
      expect(e.type).toBe('event');
      expect(e.params.namespace).toEqual([]);
      expect(e.params.timestamp).toBe(TIMESTAMP);
    }
    expect(start.params.node).toBe('model');
    expect(blockStart.params.node).toBe('model');
    expect(delta1.params.node).toBe('model');
    expect(delta2.params.node).toBeUndefined();
  });

  it('passes an updates chunk through as one updates event (case B)', () => {
    const adapter = new ProtocolAdapter();
    const events = adapter.consume({
      event: 'updates',
      data: { model: { messages: [] } },
    });
    expect(events).toHaveLength(1);
    const [updates] = events;
    expect(updates.seq).toBe(0);
    expect(updates.method).toBe('updates');
    expect(updates.params.data).toEqual({ model: { messages: [] } });
    expect(updates.params.node).toBeUndefined();
  });

  it('closes the open message and opens a new one when the id changes (case C)', () => {
    const adapter = new ProtocolAdapter();
    const streamed = [
      ...adapter.consume({
        event: 'messages',
        data: [
          {
            id: 'ai-1',
            content: 'one',
            usage_metadata: {
              input_tokens: 1,
              output_tokens: 2,
              total_tokens: 3,
            },
          },
          {},
        ],
      }),
      ...adapter.consume({
        event: 'messages',
        data: [{ id: 'ai-2', content: 'two' }, {}],
      }),
    ];
    expect(streamed.map((e) => [e.seq, e.method])).toEqual([
      [0, 'messages'],
      [1, 'messages'],
      [2, 'messages'],
      [3, 'messages'],
      [4, 'messages'],
      [5, 'messages'],
      [6, 'messages'],
      [7, 'messages'],
    ]);
    const [
      start1,
      blockStart1,
      delta1,
      blockFinish,
      finish,
      start2,
      blockStart2,
      delta2,
    ] = streamed;
    expect(start1.params.data).toEqual({
      event: 'message-start',
      role: 'assistant',
      id: 'ai-1',
    });
    expect(blockStart1.params.data).toEqual({
      event: 'content-block-start',
      index: 0,
      content: { type: 'text', text: '' },
    });
    expect(delta1.params.data).toEqual({
      event: 'content-block-delta',
      index: 0,
      delta: { type: 'text-delta', text: 'one' },
    });
    expect(blockFinish.params.data).toEqual({
      event: 'content-block-finish',
      index: 0,
    });
    expect(finish.params.data).toEqual({
      event: 'message-finish',
      usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
    });
    expect(start2.params.data).toEqual({
      event: 'message-start',
      role: 'assistant',
      id: 'ai-2',
    });
    expect(blockStart2.params.data).toEqual({
      event: 'content-block-start',
      index: 0,
      content: { type: 'text', text: '' },
    });
    expect(delta2.params.data).toEqual({
      event: 'content-block-delta',
      index: 0,
      delta: { type: 'text-delta', text: 'two' },
    });
    // The usage of ai-1 does not leak into the message-finish of ai-2.
    const closed = adapter.flush();
    expect(closed.map((e) => e.params.data)).toEqual([
      { event: 'content-block-finish', index: 0 },
      { event: 'message-finish' },
      { event: 'completed' },
    ]);
  });

  it('emits nothing for tool-call chunks that carry no text (case D)', () => {
    const adapter = new ProtocolAdapter();
    // Case A-style chunks open ai-1 first.
    adapter.consume({ event: 'metadata', data: { run_id: 'run-1' } });
    adapter.consume({
      event: 'messages',
      data: [{ id: 'ai-1', content: 'Hello' }, { langgraph_node: 'model' }],
    });
    const toolEvents = adapter.consume({
      event: 'messages',
      data: [
        {
          id: 'ai-1',
          content: '',
          tool_call_chunks: [
            { name: 'get_weather', args: '{}', id: 'call-1', index: 0 },
          ],
        },
        {},
      ],
    });
    expect(toolEvents).toEqual([]);
  });

  it('joins array content blocks into one text delta (case E)', () => {
    const adapter = new ProtocolAdapter();
    const events = adapter.consume({
      event: 'messages',
      data: [
        {
          id: 'ai-1',
          content: [
            { type: 'text', text: 'a' },
            { type: 'text', text: 'b' },
          ],
        },
        {},
      ],
    });
    expect(events.map((e) => e.params.data)).toEqual([
      { event: 'message-start', role: 'assistant', id: 'ai-1' },
      {
        event: 'content-block-start',
        index: 0,
        content: { type: 'text', text: '' },
      },
      {
        event: 'content-block-delta',
        index: 0,
        delta: { type: 'text-delta', text: 'ab' },
      },
    ]);
  });

  it('ignores unknown events and emits completed exactly once (case F)', () => {
    const adapter = new ProtocolAdapter();
    expect(adapter.consume({ event: 'debug', data: {} })).toEqual([]);
    const flushed = adapter.flush();
    expect(flushed.map((e) => [e.seq, e.method, e.params.data])).toEqual([
      [0, 'lifecycle', { event: 'completed' }],
    ]);
    expect(adapter.flush()).toEqual([]);
  });

  it('keeps the last non-null usage for message-finish (case G)', () => {
    const adapter = new ProtocolAdapter();
    adapter.consume({
      event: 'messages',
      data: [
        {
          id: 'ai-1',
          content: 'a',
          usage_metadata: {
            input_tokens: 2,
            output_tokens: 3,
            total_tokens: 5,
          },
        },
        {},
      ],
    });
    adapter.consume({
      event: 'messages',
      data: [{ id: 'ai-1', content: 'b' }, {}],
    });
    const closed = adapter.flush();
    expect(closed.map((e) => e.params.data)).toEqual([
      { event: 'content-block-finish', index: 0 },
      {
        event: 'message-finish',
        usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
      },
      { event: 'completed' },
    ]);
  });

  it('types the protocol envelope structurally for the langgraph SSE writer', () => {
    const usage: UsageInfo = {
      input_tokens: 1,
      output_tokens: 2,
      total_tokens: 3,
    };
    const event: ProtocolEvent = {
      type: 'event',
      seq: 0,
      method: 'messages',
      params: { namespace: [], timestamp: 0, data: usage },
    };
    // src/utils/sse.ts keeps formatting langgraph-typed events until Task 5
    // drops the import. The local type must stay assignable to it.
    const asLanggraph: LanggraphProtocolEvent = event;
    expect(asLanggraph.seq).toBe(0);
    expect(event.params.data).toBe(usage);
  });
});
