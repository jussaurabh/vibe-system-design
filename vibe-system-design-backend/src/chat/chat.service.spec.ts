import { Writable } from 'node:stream';
import { HumanMessage } from '@langchain/core/messages';
import { NotFoundException } from '@nestjs/common';
import type { ProtocolEvent } from '@langchain/langgraph';
import type { Client, Thread } from '@langchain/langgraph-sdk';

import type { StreamableAgent } from '../agent/agent.provider.js';
import {
  buildLoggingParams,
  setLoggingParams,
} from '../logging/logging-config.js';
import { HARDCODED_USER_ID } from './chat.constants.js';
import { ChatService, toSessionSummary } from './chat.service.js';
import { FakeChatRepository } from './fake-chat.repository.js';

function stubAgent(events: ProtocolEvent[]) {
  return {
    modelName: 'test-model',
    streamEvents: vi.fn().mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        for (const event of events) yield event;
      },
    }),
  };
}

function messageEvent(method: string, data: unknown): ProtocolEvent {
  return {
    type: 'event',
    seq: 1,
    method,
    params: { namespace: [], timestamp: 0, data },
  } as ProtocolEvent;
}

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

/** The fake client threads API, with working defaults. */
function stubClient() {
  return {
    threads: {
      search: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue(threadFixture()),
      get: vi.fn().mockResolvedValue(threadFixture()),
      update: vi.fn().mockResolvedValue(threadFixture()),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  };
}

/** Build a service with a fake repository that holds one session. */
function buildService(
  agent: StreamableAgent,
  repository = new FakeChatRepository(),
  client = stubClient(),
) {
  repository.addSession({
    id: 'ses_test',
    title: '',
    createdAt: 1000,
    updatedAt: 1000,
    lastMessageAt: null,
  });
  return {
    service: new ChatService(
      agent,
      repository,
      client as unknown as Client,
    ),
    repository,
    client,
  };
}

describe('ChatService', () => {
  it('the user message is stored before the agent runs', async () => {
    const agent = stubAgent([]);
    const { service, repository } = buildService(agent);

    for await (const _event of service.stream(
      'ses_test',
      'hi',
      new AbortController().signal,
    )) {
      // The stream carries no event in this test.
    }

    const stored = await repository.listMessages('ses_test');
    expect(stored).toHaveLength(1);
    expect(stored[0].senderType).toBe('user');
    expect(stored[0].content).toEqual([{ type: 'text', text: 'hi' }]);

    const received = agent.streamEvents.mock.calls[0][0];
    expect(received.messages).toHaveLength(1);
    expect(received.messages.at(-1)).toBeInstanceOf(HumanMessage);
    expect(
      JSON.stringify((received.messages.at(-1) as HumanMessage).content),
    ).toBe('"hi"');
  });

  it('an unknown session id is a 404', async () => {
    const agent = stubAgent([]);
    const service = new ChatService(
      agent,
      new FakeChatRepository(),
      stubClient() as unknown as Client,
    );

    await expect(async () => {
      for await (const _event of service.stream(
        'ses_missing',
        'hi',
        new AbortController().signal,
      )) {
        // The stream never starts.
      }
    }).rejects.toBeInstanceOf(NotFoundException);
    expect(agent.streamEvents).not.toHaveBeenCalled();
  });

  it('the session id is the thread id of the agent', async () => {
    const agent = stubAgent([]);
    const { service } = buildService(agent);

    for await (const _event of service.stream(
      'ses_test',
      'hi',
      new AbortController().signal,
    )) {
      // The stream carries no event in this test.
    }

    expect(agent.streamEvents).toHaveBeenCalledWith(expect.anything(), {
      version: 'v3',
      configurable: {
        thread_id: 'ses_test',
        user_id: 'user-local-dev',
        session_id: 'ses_test',
      },
      signal: expect.anything(),
    });
  });

  it('a stopped stream stores the partial reply', async () => {
    const agent = stubAgent([
      messageEvent('messages', { event: 'message-start', id: 'm-1' }),
      messageEvent('messages', {
        event: 'content-block-delta',
        delta: { type: 'text-delta', text: 'partial' },
      }),
    ]);
    const { service, repository } = buildService(agent);

    for await (const _event of service.stream(
      'ses_test',
      'hi',
      new AbortController().signal,
    )) {
      // The stream ends with the assistant message still open.
    }

    const stored = await repository.listMessages('ses_test');
    const reply = stored.find((row) => row.senderType === 'assistant');
    expect(reply).toBeDefined();
    expect(reply?.status).toBe('incomplete');
    expect(reply?.content).toEqual([{ type: 'text', text: 'partial' }]);
  });

  it('the title is cut from the first user message', async () => {
    const agent = stubAgent([]);
    const { service, repository } = buildService(agent);

    for await (const _event of service.stream(
      'ses_test',
      'a'.repeat(200),
      new AbortController().signal,
    )) {
      // The stream carries no event in this test.
    }

    const session = await repository.getSession(HARDCODED_USER_ID, 'ses_test');
    expect(session?.title.length).toBeLessThanOrEqual(60);
    expect(session?.title.length).toBeGreaterThan(0);
  });

  it('a run the user stopped stores the partial reply as incomplete', async () => {
    const controller = new AbortController();
    const agent = {
      modelName: 'test-model',
      streamEvents: vi.fn(async () => ({
        [Symbol.asyncIterator]: async function* () {
          yield messageEvent('messages', { event: 'message-start', id: 'm-1' });
          yield messageEvent('messages', {
            event: 'content-block-delta',
            delta: { type: 'text-delta', text: 'partial' },
          });
          // The user pressed stop. The run fails and the signal is aborted.
          controller.abort();
          throw new Error('Abort');
        },
      })),
    };
    const { service, repository } = buildService(agent);

    await expect(async () => {
      for await (const _event of service.stream(
        'ses_test',
        'hi',
        controller.signal,
      )) {
        // The stream ends with the run.
      }
    }).rejects.toThrow('Abort');

    const stored = await repository.listMessages('ses_test');
    const reply = stored.find((row) => row.senderType === 'assistant');
    expect(reply?.status).toBe('incomplete');
    expect(reply?.content).toEqual([{ type: 'text', text: 'partial' }]);
  });

  it('a failed run stores the reply as an error', async () => {
    const agent = {
      modelName: 'test-model',
      streamEvents: vi.fn(async () => ({
        [Symbol.asyncIterator]: async function* () {
          yield messageEvent('messages', { event: 'message-start', id: 'm-1' });
          yield messageEvent('messages', {
            event: 'content-block-delta',
            delta: { type: 'text-delta', text: 'partial' },
          });
          throw new Error('the model exploded');
        },
      })),
    };
    const { service, repository } = buildService(agent);

    await expect(async () => {
      for await (const _event of service.stream(
        'ses_test',
        'hi',
        new AbortController().signal,
      )) {
        // The stream ends with the run.
      }
    }).rejects.toThrow('the model exploded');

    const stored = await repository.listMessages('ses_test');
    const reply = stored.find((row) => row.senderType === 'assistant');
    expect(reply?.status).toBe('error');
  });

  it('a database write failure does not break the stream', async () => {
    const event = messageEvent('messages', {
      event: 'message-start',
      id: 'm-1',
    });
    const agent = stubAgent([event]);
    const { service, repository } = buildService(agent);
    vi.spyOn(repository, 'appendMessage').mockRejectedValue(
      new Error('the database is down'),
    );

    const received: ProtocolEvent[] = [];
    for await (const receivedEvent of service.stream(
      'ses_test',
      'hi',
      new AbortController().signal,
    )) {
      received.push(receivedEvent);
    }

    expect(agent.streamEvents).toHaveBeenCalled();
    expect(received).toEqual([event]);
  });

  it('a failed write is logged as one app line with the error', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback): void {
        lines.push(String(chunk));
        callback();
      },
    });
    setLoggingParams(buildLoggingParams({ NODE_ENV: 'development' }, stream));
    const agent = stubAgent([]);
    const { service, repository } = buildService(agent);
    vi.spyOn(repository, 'appendMessage').mockRejectedValue(
      new Error('the database is down'),
    );

    for await (const _event of service.stream(
      'ses_test',
      'hi',
      new AbortController().signal,
    )) {
      void _event;
    }

    const parsed = lines
      .join('')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    // Only the error line is under test; other app lines (like the history
    // load) may appear around it.
    const [line] = parsed.filter(
      (candidate) =>
        candidate['level'] === 'error' &&
        candidate['logType'] === 'app' &&
        candidate['context'] === 'ChatService',
    );
    const err = line?.['err'] as Record<string, unknown>;

    expect(line).toBeDefined();
    expect(err['message']).toBe('the database is down');
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
    const service = new ChatService(
      stubAgent([]),
      new FakeChatRepository(),
      client as unknown as Client,
    );

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

  it('createSession creates the thread and the transitional row', async () => {
    const repository = new FakeChatRepository();
    const client = stubClient();
    client.threads.create.mockResolvedValue(threadFixture());
    const service = new ChatService(
      stubAgent([]),
      repository,
      client as unknown as Client,
    );

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
    // The chat_messages foreign key needs the row until Task 4.
    const row = await repository.getSession(HARDCODED_USER_ID, THREAD_ID);
    expect(row?.id).toBe(THREAD_ID);
  });

  it('getSession maps the thread to a summary', async () => {
    const client = stubClient();
    client.threads.get.mockResolvedValue(
      threadFixture({ metadata: { title: 'A session' } }),
    );
    const service = new ChatService(
      stubAgent([]),
      new FakeChatRepository(),
      client as unknown as Client,
    );

    const session = await service.getSession(THREAD_ID);

    expect(client.threads.get).toHaveBeenCalledWith(THREAD_ID);
    expect(session.title).toBe('A session');
  });

  it('a missing thread is the same 404 as today', async () => {
    const client = stubClient();
    client.threads.get.mockRejectedValue(notFound());
    const service = new ChatService(
      stubAgent([]),
      new FakeChatRepository(),
      client as unknown as Client,
    );

    await expect(service.getSession(THREAD_ID)).rejects.toThrow(
      `The session ${THREAD_ID} does not exist.`,
    );
  });

  it('renameSession writes the title into the thread metadata only', async () => {
    const repository = new FakeChatRepository();
    repository.addSession({
      id: THREAD_ID,
      title: '',
      createdAt: 1000,
      updatedAt: 1000,
      lastMessageAt: null,
    });
    const client = stubClient();
    client.threads.get.mockResolvedValue(
      threadFixture({ metadata: { source: 'input', title: '' } }),
    );
    client.threads.update.mockResolvedValue(
      threadFixture({ metadata: { source: 'input', title: 'A new title' } }),
    );
    const renameRow = vi.spyOn(repository, 'renameSession');
    const service = new ChatService(
      stubAgent([]),
      repository,
      client as unknown as Client,
    );

    const session = await service.renameSession(THREAD_ID, 'A new title');

    expect(client.threads.update).toHaveBeenCalledWith(THREAD_ID, {
      metadata: { source: 'input', title: 'A new title' },
    });
    expect(session.title).toBe('A new title');
    expect(renameRow).not.toHaveBeenCalled();
  });

  it('deleteSession deletes the thread and the row', async () => {
    const repository = new FakeChatRepository();
    repository.addSession({
      id: THREAD_ID,
      title: '',
      createdAt: 1000,
      updatedAt: 1000,
      lastMessageAt: null,
    });
    const client = stubClient();
    const service = new ChatService(
      stubAgent([]),
      repository,
      client as unknown as Client,
    );

    await service.deleteSession(THREAD_ID);

    expect(client.threads.delete).toHaveBeenCalledWith(THREAD_ID);
    expect(
      await repository.getSession(HARDCODED_USER_ID, THREAD_ID),
    ).toBeNull();
  });

  it('the stream stores the auto-title in the thread metadata next to the row', async () => {
    const agent = stubAgent([]);
    const { service, repository, client } = buildService(agent);
    client.threads.get.mockResolvedValue(
      threadFixture({
        thread_id: 'ses_test',
        metadata: { source: 'input', title: '' },
      }),
    );

    for await (const _event of service.stream(
      'ses_test',
      'a'.repeat(200),
      new AbortController().signal,
    )) {
      // The stream carries no event in this test.
    }

    expect(client.threads.get).toHaveBeenCalledWith('ses_test');
    expect(client.threads.update).toHaveBeenCalledWith('ses_test', {
      metadata: { source: 'input', title: 'a'.repeat(60) },
    });
    // The DB rename still happens until Task 4 removes it.
    const session = await repository.getSession(HARDCODED_USER_ID, 'ses_test');
    expect(session?.title).toBe('a'.repeat(60));
  });

  it('a named session gets no metadata auto-title', async () => {
    const repository = new FakeChatRepository();
    repository.addSession({
      id: 'ses_test',
      title: 'Already named',
      createdAt: 1000,
      updatedAt: 1000,
      lastMessageAt: null,
    });
    const client = stubClient();
    const service = new ChatService(
      stubAgent([]),
      repository,
      client as unknown as Client,
    );

    for await (const _event of service.stream(
      'ses_test',
      'hi',
      new AbortController().signal,
    )) {
      // The stream carries no event in this test.
    }

    expect(client.threads.get).not.toHaveBeenCalled();
    expect(client.threads.update).not.toHaveBeenCalled();
  });

  it('a thread metadata title failure does not break the stream', async () => {
    const agent = stubAgent([]);
    const repository = new FakeChatRepository();
    repository.addSession({
      id: 'ses_test',
      title: '',
      createdAt: 1000,
      updatedAt: 1000,
      lastMessageAt: null,
    });
    const client = stubClient();
    client.threads.get.mockRejectedValue(new Error('the agent server is down'));
    const service = new ChatService(
      agent,
      repository,
      client as unknown as Client,
    );

    const received: ProtocolEvent[] = [];
    for await (const event of service.stream(
      'ses_test',
      'hi',
      new AbortController().signal,
    )) {
      received.push(event);
    }

    expect(client.threads.get).toHaveBeenCalledWith('ses_test');
    expect(received).toEqual([]);
  });
});
