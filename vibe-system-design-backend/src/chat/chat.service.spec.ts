import { Writable } from 'node:stream';
import { HumanMessage } from '@langchain/core/messages';
import { NotFoundException } from '@nestjs/common';
import type { ProtocolEvent } from '@langchain/langgraph';

import type { StreamableAgent } from '../agent/agent.provider.js';
import {
  buildLoggingParams,
  setLoggingParams,
} from '../logging/logging-config.js';
import { HARDCODED_USER_ID } from './chat.constants.js';
import { ChatService } from './chat.service.js';
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

/** Build a service with a fake repository that holds one session. */
function buildService(
  agent: StreamableAgent,
  repository = new FakeChatRepository(),
) {
  repository.addSession({
    id: 'ses_test',
    title: '',
    createdAt: 1000,
    updatedAt: 1000,
    lastMessageAt: null,
  });
  return { service: new ChatService(agent, repository), repository };
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
    expect(received.messages.at(-1)).toBeInstanceOf(HumanMessage);
    expect(
      JSON.stringify((received.messages.at(-1) as HumanMessage).content),
    ).toBe('"hi"');
  });

  it('an unknown session id is a 404', async () => {
    const agent = stubAgent([]);
    const service = new ChatService(agent, new FakeChatRepository());

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
