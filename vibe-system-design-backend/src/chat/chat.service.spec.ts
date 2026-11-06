import { NotFoundException } from '@nestjs/common';
import type { Client, Thread } from '@langchain/langgraph-sdk';

import { ChatService, toSessionSummary } from './chat.service.js';
import type { AgentServerChunk } from './protocol-adapter.js';
import type { ProtocolEvent } from '../utils/protocol-event.js';
import type { ChatMessageRow } from '../db/schema.js';
import { CHAT_MESSAGES_REPOSITORY, type ChatMessagesRepository } from './chat-messages.repository.js';

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

/** A minimal assistant row fixture. */
function assistantRowFixture(overrides: Partial<ChatMessageRow> = {}): ChatMessageRow {
  return {
    seq: 1,
    threadId: THREAD_ID,
    langgraphId: 'ai-1',
    role: 'assistant',
    status: 'complete',
    parts: [{ type: 'text', text: 'hello' }],
    modelName: 'test-model',
    inputTokens: 5,
    outputTokens: 7,
    reasoningTokens: 2,
    latencyMs: 100,
    runId: 'run-1',
    createdAt: new Date(UPDATED_AT),
    ...overrides,
  };
}

/** A minimal user row fixture. */
function userRowFixture(overrides: Partial<ChatMessageRow> = {}): ChatMessageRow {
  return {
    seq: 0,
    threadId: THREAD_ID,
    langgraphId: null,
    role: 'user',
    status: 'complete',
    parts: [{ type: 'text', text: 'hi' }],
    modelName: null,
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    latencyMs: null,
    runId: null,
    createdAt: new Date(CREATED_AT),
    ...overrides,
  };
}

/** The Case A chunk sequence of the ProtocolAdapter spec. */
const CASE_A_CHUNKS: AgentServerChunk[] = [
  { event: 'metadata', data: { run_id: 'run-1' } },
  {
    event: 'messages',
    data: [{ id: 'ai-1', content: 'Hello', type: 'ai' }, { langgraph_node: 'model' }],
  },
  {
    event: 'messages',
    data: [
      {
        id: 'ai-1',
        content: ' world',
        type: 'ai',
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

/** The fake messages repository, with working defaults. */
function stubMessages(): ChatMessagesRepository & {
  appendUser: ReturnType<typeof vi.fn>;
  appendAssistant: ReturnType<typeof vi.fn>;
  listByThread: ReturnType<typeof vi.fn>;
  deleteByThread: ReturnType<typeof vi.fn>;
} {
  return {
    appendUser: vi.fn().mockResolvedValue(userRowFixture()),
    appendAssistant: vi.fn().mockResolvedValue(assistantRowFixture()),
    listByThread: vi.fn().mockResolvedValue([userRowFixture(), assistantRowFixture()]),
    deleteByThread: vi.fn().mockResolvedValue(undefined),
  };
}

function buildService(client = stubClient(), messages = stubMessages()) {
  return {
    service: new ChatService(client as unknown as Client, messages),
    client,
    messages,
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
      input: {
        messages: [
          { role: 'user', content: '<user_prompt>\nhi\n</user_prompt>' },
        ],
      },
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

  it('beginTurn is called before the stream starts', async () => {
    const { service, client, messages } = buildService();
    client.runs.stream.mockReturnValue(chunkStream(CASE_A_CHUNKS));

    await service.beginTurn(THREAD_ID, 'hi');
    for await (const _event of service.stream(THREAD_ID, 'hi')) {
      // consume
    }

    expect(messages.appendUser).toHaveBeenCalledWith(THREAD_ID, 'hi');
  });

  it('appendAssistant is called at stream end with complete status', async () => {
    const { service, client, messages } = buildService();
    client.runs.stream.mockReturnValue(chunkStream(CASE_A_CHUNKS));

    for await (const _event of service.stream(THREAD_ID, 'hi')) {
      // consume
    }

    expect(messages.appendAssistant).toHaveBeenCalledOnce();
    const args = messages.appendAssistant.mock.calls[0][0];
    expect(args.threadId).toBe(THREAD_ID);
    expect(args.status).toBe('complete');
    expect(args.langgraphId).toBe('ai-1');
  });

  it('appendAssistant is called with error status when stream throws', async () => {
    const { service, client, messages } = buildService();
    client.runs.stream.mockImplementation(() => ({
      [Symbol.asyncIterator]: async function* () {
        yield CASE_A_CHUNKS[0];
        yield CASE_A_CHUNKS[1];
        throw new Error('the run exploded');
      },
    }));

    await expect(async () => {
      for await (const _event of service.stream(THREAD_ID, 'hi')) {
        // consume
      }
    }).rejects.toThrow('the run exploded');

    expect(messages.appendAssistant).toHaveBeenCalledOnce();
    const args = messages.appendAssistant.mock.calls[0][0];
    expect(args.status).toBe('error');
  });

  it('appendAssistant is called with incomplete status when generator is cancelled', async () => {
    const { service, client, messages } = buildService();
    // Mock stream to yield one chunk then wait, so generator pauses at for await
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    client.runs.stream.mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield { event: 'metadata', data: { run_id: 'run-1' } };
        await gate;
        yield { event: 'messages', data: [{ id: 'ai-1', content: 'done', type: 'ai' }, {}] };
      },
    });

    const streamIter = service.stream(THREAD_ID, 'hi') as unknown as AsyncIterator<ProtocolEvent>;
    const first = await streamIter.next();
    expect(first.done).toBe(false);
    // Cancel the generator before releasing the gate
    await streamIter.return?.();
    // Release gate to avoid unhandled promise
    releaseGate();

    expect(messages.appendAssistant).toHaveBeenCalledOnce();
    const args = messages.appendAssistant.mock.calls[0][0];
    expect(args.status).toBe('incomplete');
  });
});

describe('ChatService stop', () => {
  it('stopSession interrupts the active runs of the thread', async () => {
    const { service, client, messages } = buildService();
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
    const { service, client, messages } = buildService();
    client.runs.list.mockResolvedValue([{ run_id: 'run-1', status: 'running' }]);
    client.runs.cancel.mockRejectedValue(notFound());

    await expect(service.stopSession(THREAD_ID)).resolves.toBeUndefined();
  });

  it('a missing session is a 404 on stop', async () => {
    const { service, client, messages } = buildService();
    client.runs.list.mockRejectedValue(notFound());

    await expect(service.stopSession(THREAD_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('stopSession marks the session as stopRequested when active', async () => {
    const { service, client, messages } = buildService();

    // Create a gated stream that we can control
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    client.runs.stream.mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield { event: 'metadata', data: { run_id: 'run-1' } };
        await gate;
        yield { event: 'messages', data: [{ id: 'ai-1', content: 'done', type: 'ai' }, {}] };
      },
    });
    client.runs.list.mockResolvedValue([{ run_id: 'run-1', status: 'running' }]);

    // Start a stream
    const streamPromise = (async () => {
      for await (const _ of service.stream(THREAD_ID, 'hi')) {
        // consume
      }
    })();

    // Wait for stream to start (activeSessions will have the session)
    await new Promise((r) => setTimeout(r, 10));

    // Call stopSession while stream is active
    await service.stopSession(THREAD_ID);

    // Release the gate to let stream complete
    releaseGate();
    await streamPromise;

    expect(messages.appendAssistant).toHaveBeenCalled();
    const args = messages.appendAssistant.mock.calls[0][0];
    expect(args.status).toBe('incomplete');
  });
});

describe('ChatService ensureTitle', () => {
  it('ensureTitle writes the cut title into the empty thread metadata', async () => {
    const { service, client, messages } = buildService();
    client.threads.get.mockResolvedValue(threadFixture({ metadata: {} }));

    await service.ensureTitle(THREAD_ID, 'a'.repeat(200));

    expect(client.threads.get).toHaveBeenCalledWith(THREAD_ID);
    expect(client.threads.update).toHaveBeenCalledWith(THREAD_ID, {
      metadata: { title: 'a'.repeat(60) },
    });
  });

  it('ensureTitle keeps the other metadata keys', async () => {
    const { service, client, messages } = buildService();
    client.threads.get.mockResolvedValue(
      threadFixture({ metadata: { source: 'input', title: '' } }),
    );

    await service.ensureTitle(THREAD_ID, 'a'.repeat(200));

    expect(client.threads.update).toHaveBeenCalledWith(THREAD_ID, {
      metadata: { source: 'input', title: 'a'.repeat(60) },
    });
  });

  it('ensureTitle does nothing when the title is set', async () => {
    const { service, client, messages } = buildService();
    client.threads.get.mockResolvedValue(
      threadFixture({ metadata: { title: 'Already named' } }),
    );

    await service.ensureTitle(THREAD_ID, 'hi');

    expect(client.threads.get).toHaveBeenCalledWith(THREAD_ID);
    expect(client.threads.update).not.toHaveBeenCalled();
  });
});

describe('ChatService listMessages', () => {
  it('listMessages returns repository rows mapped to StoredMessage', async () => {
    const { service, client, messages } = buildService();
    messages.listByThread.mockResolvedValue([
      userRowFixture({ seq: 0, parts: [{ type: 'text', text: 'hi' }] }),
      assistantRowFixture({ seq: 1, parts: [{ type: 'text', text: 'hello' }] }),
    ]);

    const result = await service.listMessages(THREAD_ID);

    expect(client.threads.get).toHaveBeenCalledWith(THREAD_ID);
    expect(messages.listByThread).toHaveBeenCalledWith(THREAD_ID);
    expect(result).toHaveLength(2);
    expect(result[0].senderType).toBe('user');
    expect(result[1].senderType).toBe('assistant');
  });

  it('listMessages answers an empty list for a thread that never ran', async () => {
    const { service, client, messages } = buildService();
    messages.listByThread.mockResolvedValue([]);

    await expect(service.listMessages(THREAD_ID)).resolves.toEqual([]);
  });

  it('a missing thread is a 404 on listMessages', async () => {
    const { service, client, messages } = buildService();
    client.threads.get.mockRejectedValue(notFound());

    await expect(service.listMessages(THREAD_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(messages.listByThread).not.toHaveBeenCalled();
  });
});

describe('ChatService deleteSession', () => {
  it('deleteSession deletes the thread and deletes chat_messages rows', async () => {
    const { service, client, messages } = buildService();

    await expect(service.deleteSession(THREAD_ID)).resolves.toBeUndefined();

    expect(client.threads.delete).toHaveBeenCalledWith(THREAD_ID);
    expect(messages.deleteByThread).toHaveBeenCalledWith(THREAD_ID);
  });

  it('deleteSession stays idempotent when thread delete fails with 404', async () => {
    const { service, client, messages } = buildService();
    client.threads.delete.mockRejectedValue(notFound());

    await expect(service.deleteSession(THREAD_ID)).resolves.toBeUndefined();

    expect(messages.deleteByThread).toHaveBeenCalledWith(THREAD_ID);
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
    const { service, client, messages } = buildService();

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
});