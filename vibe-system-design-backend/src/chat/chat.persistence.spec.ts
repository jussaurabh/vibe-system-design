import type { ProtocolEvent } from '@langchain/langgraph';

import { RunRecorder, type RecordedMessage } from './chat.persistence.js';

function event(method: string, data: unknown): ProtocolEvent {
  return { type: 'event', seq: 0, method, params: { namespace: [], timestamp: 0, data } } as ProtocolEvent;
}

function collect() {
  const rows: RecordedMessage[] = [];
  let id = 0;
  const recorder = new RunRecorder({
    newMessageId: () => `msg_test_${++id}`,
    now: () => 1000,
    modelName: 'test-model',
    onRow: (row) => rows.push(row),
  });
  return { recorder, rows };
}

/** Feed a full assistant message and return the events. */
function fullMessage(text: string): ProtocolEvent[] {
  return [
    event('messages', { event: 'message-start', id: 'm-1', role: 'ai' }),
    event('messages', {
      event: 'content-block-start',
      index: 0,
      contentBlock: { type: 'text' },
    }),
    event('messages', {
      event: 'content-block-delta',
      index: 0,
      delta: { type: 'text-delta', text },
    }),
    event('messages', { event: 'content-block-finish', index: 0 }),
    event('messages', { event: 'message-finish', id: 'm-1' }),
  ];
}

describe('RunRecorder', () => {
  it('a text stream records one assistant row', () => {
    const { recorder, rows } = collect();
    for (const e of fullMessage('hi')) recorder.handle(e);

    expect(rows).toHaveLength(1);
    expect(rows[0].senderType).toBe('assistant');
    expect(rows[0].content).toEqual([{ type: 'text', text: 'hi' }]);
    expect(rows[0].status).toBe('complete');
    expect(rows[0].modelName).toBe('test-model');
  });

  it('a stopped stream records the partial reply as incomplete', () => {
    const { recorder, rows } = collect();
    recorder.handle(event('messages', { event: 'message-start' }));
    recorder.handle(
      event('messages', {
        event: 'content-block-start',
        contentBlock: { type: 'text' },
      }),
    );
    recorder.handle(
      event('messages', {
        event: 'content-block-delta',
        delta: { type: 'text-delta', text: 'hi' },
      }),
    );
    recorder.finish('incomplete');

    expect(rows).toHaveLength(1);
    expect(rows[0].content).toEqual([{ type: 'text', text: 'hi' }]);
    expect(rows[0].status).toBe('incomplete');
  });

  it('a failed stream records the reply as an error', () => {
    const { recorder, rows } = collect();
    recorder.handle(event('messages', { event: 'message-start' }));
    recorder.handle(
      event('messages', {
        event: 'content-block-start',
        contentBlock: { type: 'text' },
      }),
    );
    recorder.handle(
      event('messages', {
        event: 'content-block-delta',
        delta: { type: 'text-delta', text: 'hi' },
      }),
    );
    recorder.finish('error');

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('error');
  });

  it('a run with two assistant messages records two rows in order', () => {
    const { recorder, rows } = collect();
    for (const e of fullMessage('one')) recorder.handle(e);
    for (const e of fullMessage('two')) recorder.handle(e);

    expect(rows).toHaveLength(2);
    expect(rows[0].content).toEqual([{ type: 'text', text: 'one' }]);
    expect(rows[1].content).toEqual([{ type: 'text', text: 'two' }]);
  });

  it('a tool call records a tool row', () => {
    const { recorder, rows } = collect();
    recorder.handle(
      event('tools', {
        event: 'tool-started',
        toolCallId: 'call_1',
        name: 'write_todos',
        input: { a: 1 },
      }),
    );
    recorder.handle(event('tools', { event: 'tool-finished', output: 'done' }));

    expect(rows).toHaveLength(1);
    expect(rows[0].senderType).toBe('tool');
    expect(rows[0].content).toEqual([
      {
        type: 'tool',
        toolCallId: 'call_1',
        name: 'write_todos',
        input: { a: 1 },
        output: 'done',
        status: 'complete',
      },
    ]);
  });

  it('a tool payload in the alternative field names is also read', () => {
    const { recorder, rows } = collect();
    recorder.handle(
      event('tools', {
        event: 'tool-started',
        tool_call_id: 'call_2',
        tool: { name: 'ls' },
        args: {},
      }),
    );
    recorder.handle(event('tools', { event: 'tool-finished', result: 'ok' }));

    expect(rows).toHaveLength(1);
    const part = rows[0].content[0];
    expect(part).toMatchObject({ type: 'tool', toolCallId: 'call_2', name: 'ls' });
  });

  it('a usage event attaches the token count to the open message', () => {
    const { recorder, rows } = collect();
    for (const e of fullMessage('hi')) recorder.handle(e);
    recorder.handle(event('messages', { event: 'usage', usage: { total_tokens: 42 } }));

    expect(rows).toHaveLength(1);
    expect(rows[0].tokenCount).toBe(42);
  });

  it('a reasoning delta is not stored', () => {
    const { recorder, rows } = collect();
    recorder.handle(event('messages', { event: 'message-start' }));
    recorder.handle(
      event('messages', {
        event: 'content-block-delta',
        delta: { type: 'reasoning-delta', reasoning: 'thinking' },
      }),
    );
    recorder.handle(event('messages', { event: 'message-finish' }));

    expect(rows).toHaveLength(1);
    expect(rows[0].content).toEqual([]);
  });

  it('a delta payload without an event name is still read', () => {
    const { recorder, rows } = collect();
    recorder.handle(event('messages', { event: 'message-start' }));
    recorder.handle(event('messages', { type: 'text-delta', text: 'hi' }));
    recorder.handle(event('messages', { event: 'message-finish' }));

    expect(rows).toHaveLength(1);
    expect(rows[0].content).toEqual([{ type: 'text', text: 'hi' }]);
  });

  it('a text block opens a part from the protocol field content', () => {
    const { recorder, rows } = collect();
    recorder.handle(event('messages', { event: 'message-start' }));
    recorder.handle(
      event('messages', {
        event: 'content-block-start',
        index: 0,
        content: { type: 'text', text: '' },
      }),
    );
    recorder.handle(
      event('messages', {
        event: 'content-block-delta',
        index: 0,
        delta: { type: 'text-delta', text: 'Hello' },
      }),
    );
    recorder.handle(event('messages', { event: 'content-block-finish', index: 0 }));
    recorder.handle(
      event('messages', {
        event: 'content-block-start',
        index: 1,
        content: { type: 'text', text: '' },
      }),
    );
    recorder.handle(
      event('messages', {
        event: 'content-block-delta',
        index: 1,
        delta: { type: 'text-delta', text: ' world' },
      }),
    );
    recorder.handle(event('messages', { event: 'content-block-finish', index: 1 }));
    recorder.handle(event('messages', { event: 'message-finish' }));

    expect(rows).toHaveLength(1);
    expect(rows[0].content).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' },
    ]);
  });

  it('a tool row reads the name from the protocol field tool_name', () => {
    const { recorder, rows } = collect();
    recorder.handle(
      event('tools', {
        event: 'tool-started',
        tool_call_id: 'call_3',
        tool_name: 'write_todos',
        input: { a: 1 },
      }),
    );
    recorder.handle(event('tools', { event: 'tool-finished', output: 'done' }));

    expect(rows).toHaveLength(1);
    expect(rows[0].content[0]).toMatchObject({
      type: 'tool',
      toolCallId: 'call_3',
      name: 'write_todos',
    });
  });

  it('a message finish carries the token count', () => {
    const { recorder, rows } = collect();
    recorder.handle(event('messages', { event: 'message-start' }));
    recorder.handle(
      event('messages', {
        event: 'message-finish',
        usage: { input_tokens: 10, output_tokens: 32, total_tokens: 42 },
      }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].tokenCount).toBe(42);
  });
});
