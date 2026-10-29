import { NotFoundException } from '@nestjs/common';
import type { Client, Thread } from '@langchain/langgraph-sdk';

import { ChatService, toSessionSummary } from './chat.service.js';
import type { AgentServerChunk } from './protocol-adapter.js';
import type { ProtocolEvent } from '../utils/protocol-event.js';

const THREAD_ID = '123e4567-e89b-42d3-a456-426614174000';
const CREATED_AT = '2026-01-01T00:00:00.000Z';
const UPDATED_AT = '2026-01-02T00:00:00.000Z';

function threadFixture(overrides: Partial<Thread> = {}): Thread {
  return {
    thread_id: THREAD_ID,
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
    state_updated_at: UPDATED_AT,
    metadata: {},
    status: 'idle',
    values: {},
    interrupts: {},
    ...overrides,
  };
}

/** The error the Agent Server throws for a missing thread. */
function notFound(): Error {
  return Object.assign(new Error('HTTP 404: Not Found'), { status: 404 });
}

/** The Case A chunk sequence of the ProtocolAdapter spec. */
const CASE_A_CHUNKS: AgentServerChunk[] = [
  { event: 'metadata', data: { run_id: 'run-1' } },
  {
    event: 'messages',
    data: [{ id: 'ai-1', content: 'Hello' }, { langgraph_node: 'model' }],
  },
  {
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
  },
];

/** An async iterable that yields the given chunks. */
function chunkStream(chunks: AgentServerChunk[]): AsyncIterable<AgentServerChunk> {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of chunks) yield chunk;
    },
  };
}

/** The fake client threads and runs APIs, with working defaults. */
function stubClient() {
  return {
    threads: {
      search: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue(threadFixture()),
      get: vi.fn().mockResolvedValue(threadFixture()),
      update: vi.fn().mockResolvedValue(threadFixture()),
      delete: vi.fn().mockResolvedValue(undefined),
      getState: vi.fn().mockResolvedValue({ values: {} }),
    },
    runs: {
      stream: vi.fn().mockReturnValue(chunkStream([])),
      list: vi.fn().mockResolvedValue([]),
      cancel: vi.fn().mockResolvedValue(undefined),
    },
  };
}

function buildService(client = stubClient()) {
  return {
    service: new ChatService(client as unknown as Client),
    client,
  };
}

describe('ChatService stream proxy', () => {
  it('the stream proxies the agent server run through the adapter', async () => {
    const { service, client } = buildService();
    client.runs.stream.mockReturnValue(chunkStream(CASE_A_CHUNKS));

    const events: ProtocolEvent[] = [];
    for await (const event of service.stream(THREAD_ID, 'hi')) {
      events.push(event);
    }

    expect(client.runs.stream).toHaveBeenCalledWith(THREAD_ID, 'agent', {
      input: { messages: [{ role: 'user', content: 'hi' }] },
      streamMode: ['messages-tuple', 'updates'],
    });
    expect(events.map((event) => [event.seq, event.method])).toEqual([
      [0, 'lifecycle'],
      [1, 'messages'],
      [2, 'messages'],
      [3, 'messages'],
      [4, 'messages'],
      [5, 'messages'],
      [6, 'messages'],
      [7, 'lifecycle'],
    ]);
    const deltas = events
      .map((event) => event.params.data as Record<string, unknown>)
      .filter((data) => data['event'] === 'content-block-delta')
      .map((data) => (data['delta'] as Record<string, unknown>)['text']);
    expect(deltas).toEqual(['Hello', ' world']);
    const finish = events
      .map((event) => event.params.data as Record<string, unknown>)
      .find((data) => data['event'] === 'message-finish');
    expect(finish?.['usage']).toEqual({
      input_tokens: 5,
      output_tokens: 7,
      total_tokens: 12,
    });
    expect(events.at(-1)?.params.data).toEqual({ event: 'completed' });
  });

  it('an upstream stream error propagates out of the stream', async () => {
    const { service, client } = buildService();
    // The failure comes from the iteration itself. The service wraps no
    // try/catch around it, so the error reaches the controller.
    client.runs.stream.mockImplementation(() => ({
      [Symbol.asyncIterator]: async function* () {
        yield CASE_A_CHUNKS[0];
        throw new Error('the run exploded');
      },
    }));

    await expect(async () => {
      for await (const _event of service.stream(THREAD_ID, 'hi')) {
        // The stream dies mid-run.
      }
    }).rejects.toThrow('the run exploded');
  });
});

describe('ChatService stop', () => {
  it('stopSession interrupts the active runs of the thread', async () => {
    const { service, client } = buildService();
    client.runs.list.mockResolvedValue([
      { run_id: 'run-done', status: 'success' },
      { run_id: 'run-busy', status: 'running' },
      { run_id: 'run-queued', status: 'pending' },
    ]);

    await service.stopSession(THREAD_ID);

    expect(client.runs.list).toHaveBeenCalledWith(THREAD_ID, { limit: 100 });
    expect(client.runs.cancel).toHaveBeenCalledTimes(2);
    expect(client.runs.cancel).toHaveBeenCalledWith(
      THREAD_ID,
      'run-busy',
      true,
      'interrupt',
    );
    expect(client.runs.cancel).toHaveBeenCalledWith(
      THREAD_ID,
      'run-queued',
      true,
      'interrupt',
    );
  });

  it('a run that ends before the cancel is not an error', async () => {
    const { service, client } = buildService();
    client.runs.list.mockResolvedValue([{ run_id: 'run-1', status: 'running' }]);
    client.runs.cancel.mockRejectedValue(notFound());

    await expect(service.stopSession(THREAD_ID)).resolves.toBeUndefined();
  });

  it('a missing session is a 404 on stop', async () => {
    const { service, client } = buildService();
    client.runs.list.mockRejectedValue(notFound());

    await expect(service.stopSession(THREAD_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('ChatService ensureTitle', () => {
  it('ensureTitle writes the cut title into the empty thread metadata', async () => {
    const { service, client } = buildService();
    client.threads.get.mockResolvedValue(threadFixture({ metadata: {} }));

    await service.ensureTitle(THREAD_ID, 'a'.repeat(200));

    expect(client.threads.get).toHaveBeenCalledWith(THREAD_ID);
    expect(client.threads.update).toHaveBeenCalledWith(THREAD_ID, {
      metadata: { title: 'a'.repeat(60) },
    });
  });

  it('ensureTitle keeps the other metadata keys', async () => {
    const { service, client } = buildService();
    client.threads.get.mockResolvedValue(
      threadFixture({ metadata: { source: 'input', title: '' } }),
    );

    await service.ensureTitle(THREAD_ID, 'a'.repeat(200));

    expect(client.threads.update).toHaveBeenCalledWith(THREAD_ID, {
      metadata: { source: 'input', title: 'a'.repeat(60) },
    });
  });

  it('ensureTitle does nothing when the title is set', async () => {
    const { service, client } = buildService();
    client.threads.get.mockResolvedValue(
      threadFixture({ metadata: { title: 'Already named' } }),
    );

    await service.ensureTitle(THREAD_ID, 'hi');

    expect(client.threads.get).toHaveBeenCalledWith(THREAD_ID);
    expect(client.threads.update).not.toHaveBeenCalled();
  });
});

describe('ChatService listMessages', () => {
  it('listMessages maps the thread state to stored messages', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    try {
      const { service, client } = buildService();
      client.threads.getState.mockResolvedValue({
        values: {
          messages: [
            { type: 'human', content: 'hi', id: 'm1' },
            { type: 'ai', content: [{ type: 'text', text: 'hello' }], id: 'm2' },
            { type: 'tool', content: 'ignored' },
          ],
        },
      });

      const messages = await service.listMessages(THREAD_ID);

      expect(client.threads.getState).toHaveBeenCalledWith(THREAD_ID);
      expect(messages).toEqual([
        {
          id: 'm1',
          sessionId: THREAD_ID,
          createdAt: 1_700_000_000_000,
          seq: 0,
          senderType: 'user',
          content: [{ type: 'text', text: 'hi' }],
          status: 'complete',
          tokenCount: null,
          modelName: null,
          latencyMs: null,
        },
        {
          id: 'm2',
          sessionId: THREAD_ID,
          createdAt: 1_700_000_000_000,
          seq: 1,
          senderType: 'assistant',
          content: [{ type: 'text', text: 'hello' }],
          status: 'complete',
          tokenCount: null,
          modelName: null,
          latencyMs: null,
        },
      ]);
    } finally {
      now.mockRestore();
    }
  });

  it('listMessages answers an empty list for a thread that never ran', async () => {
    const { service, client } = buildService();
    client.threads.getState.mockResolvedValue({ values: {} });

    await expect(service.listMessages(THREAD_ID)).resolves.toEqual([]);

    client.threads.getState.mockResolvedValue({});
    await expect(service.listMessages(THREAD_ID)).resolves.toEqual([]);
  });

  it('a missing thread is a 404 on listMessages', async () => {
    const { service, client } = buildService();
    client.threads.getState.mockRejectedValue(notFound());

    await expect(service.listMessages(THREAD_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('listMessages synthesizes the id of a message without one', async () => {
    const { service, client } = buildService();
    client.threads.getState.mockResolvedValue({
      values: {
        messages: [
          { type: 'human', content: 'hi' },
          { type: 'ai', content: 'ok' },
        ],
      },
    });

    const messages = await service.listMessages(THREAD_ID);

    expect(messages.map((message) => message.id)).toEqual([
      `${THREAD_ID}-m0`,
      `${THREAD_ID}-m1`,
    ]);
  });
});

describe('thread-backed sessions', () => {
  it('toSessionSummary maps the thread fields to the session summary', () => {
    const summary = toSessionSummary(
      threadFixture({ metadata: { title: 'A session' } }),
    );

    expect(summary).toEqual({
      id: THREAD_ID,
      title: 'A session',
      createdAt: Date.parse(CREATED_AT),
      updatedAt: Date.parse(UPDATED_AT),
      lastMessageAt: Date.parse(UPDATED_AT),
    });
  });

  it('toSessionSummary falls back to an empty title and the current time', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    try {
      const summary = toSessionSummary(
        threadFixture({
          metadata: { title: 42 },
          created_at: 'not-a-date',
          updated_at: 'also-not-a-date',
        }),
      );

      expect(summary.title).toBe('');
      expect(summary.createdAt).toBe(1_700_000_000_000);
      expect(summary.updatedAt).toBe(1_700_000_000_000);
      expect(summary.lastMessageAt).toBe(1_700_000_000_000);
    } finally {
      now.mockRestore();
    }
  });

  it('listSessions searches the threads and sorts by the latest activity', async () => {
    const older = threadFixture({
      thread_id: '11111111-1111-4111-8111-111111111111',
      updated_at: '2026-01-01T00:00:00.000Z',
    });
    const newer = threadFixture({
      thread_id: '22222222-2222-4222-8222-222222222222',
      updated_at: '2026-01-02T00:00:00.000Z',
    });
    const client = stubClient();
    client.threads.search.mockResolvedValue([older, newer]);
    const { service } = buildService(client);

    const sessions = await service.listSessions();

    expect(client.threads.search).toHaveBeenCalledWith({ limit: 100 });
    expect(sessions.map((session) => session.id)).toEqual([
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
    ]);
    expect(sessions[0]).toEqual({
      id: '22222222-2222-4222-8222-222222222222',
      title: '',
      createdAt: Date.parse(CREATED_AT),
      updatedAt: Date.parse('2026-01-02T00:00:00.000Z'),
      lastMessageAt: Date.parse('2026-01-02T00:00:00.000Z'),
    });
  });

  it('createSession creates the thread and returns its summary', async () => {
    const { service, client } = buildService();

    const session = await service.createSession();

    expect(client.threads.create).toHaveBeenCalledWith({
      metadata: { title: '' },
    });
    expect(session).toEqual({
      id: THREAD_ID,
      title: '',
      createdAt: Date.parse(CREATED_AT),
      updatedAt: Date.parse(UPDATED_AT),
      lastMessageAt: Date.parse(UPDATED_AT),
    });
  });

  it('getSession maps the thread to a summary', async () => {
    const client = stubClient();
    client.threads.get.mockResolvedValue(
      threadFixture({ metadata: { title: 'A session' } }),
    );
    const { service } = buildService(client);

    const session = await service.getSession(THREAD_ID);

    expect(client.threads.get).toHaveBeenCalledWith(THREAD_ID);
    expect(session.title).toBe('A session');
  });

  it('a missing thread is the same 404 as today', async () => {
    const client = stubClient();
    client.threads.get.mockRejectedValue(notFound());
    const { service } = buildService(client);

    await expect(service.getSession(THREAD_ID)).rejects.toThrow(
      `The session ${THREAD_ID} does not exist.`,
    );
  });

  it('renameSession writes the title into the thread metadata', async () => {
    const client = stubClient();
    client.threads.get.mockResolvedValue(
      threadFixture({ metadata: { source: 'input', title: '' } }),
    );
    client.threads.update.mockResolvedValue(
      threadFixture({ metadata: { source: 'input', title: 'A new title' } }),
    );
    const { service } = buildService(client);

    const session = await service.renameSession(THREAD_ID, 'A new title');

    expect(client.threads.update).toHaveBeenCalledWith(THREAD_ID, {
      metadata: { source: 'input', title: 'A new title' },
    });
    expect(session.title).toBe('A new title');
  });

  it('deleteSession deletes the thread and stays idempotent', async () => {
    const client = stubClient();
    const { service } = buildService(client);

    await expect(service.deleteSession(THREAD_ID)).resolves.toBeUndefined();
    expect(client.threads.delete).toHaveBeenCalledWith(THREAD_ID);

    client.threads.delete.mockRejectedValue(notFound());
    await expect(service.deleteSession(THREAD_ID)).resolves.toBeUndefined();
  });
});
