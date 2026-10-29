import { EventEmitter } from 'node:events';

import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Thread } from '@langchain/langgraph-sdk';
import request from 'supertest';

import { AGENT_SERVER_CLIENT } from '../agent-server/agent-server.module.js';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';
import type { AgentServerChunk } from './protocol-adapter.js';
import { formatDoneFrame, formatErrorFrame, formatEventFrame } from '../utils/sse.js';
import type { ProtocolEvent } from '../utils/protocol-event.js';

const THREAD_ID = '123e4567-e89b-42d3-a456-426614174000';
const CREATED_AT = '2026-01-01T00:00:00.000Z';
const UPDATED_AT = '2026-01-02T00:00:00.000Z';

function threadFixture(metadata: Record<string, unknown> = {}): Thread {
  return {
    thread_id: THREAD_ID,
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
    state_updated_at: UPDATED_AT,
    metadata,
    status: 'idle',
    values: {},
    interrupts: {},
  };
}

function passingService(events: ProtocolEvent[]) {
  return {
    async getSession() {
      return { id: 'ses_test', title: '', createdAt: 1, updatedAt: 1, lastMessageAt: null };
    },
    async ensureTitle() {},
    async *stream() {
      for (const event of events) yield event;
    },
  } as unknown as ChatService;
}

function createFakeRes() {
  const written: string[] = [];
  const res = Object.assign(new EventEmitter(), {
    writableEnded: false,
    writableFinished: false,
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn((chunk: string) => {
      written.push(chunk);
      return true;
    }),
    end: vi.fn(() => {
      res.writableEnded = true;
      res.writableFinished = true;
    }),
  });
  return { res, written };
}

const firstEvent = { type: 'event', seq: 1, method: 'messages', params: {} } as ProtocolEvent;

describe('ChatController', () => {
  it('writes headers, one frame per event, then a done frame', async () => {
    const { res, written } = createFakeRes();
    const controller = new ChatController(passingService([firstEvent]));
    const req = new EventEmitter();

    await controller.stream({ sessionId: 'ses_test', message: 'hi' }, req as any, res as any);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(res.flushHeaders).toHaveBeenCalledOnce();
    expect(written).toEqual([formatEventFrame(firstEvent), formatDoneFrame()]);
  });

  it('rejects an invalid body with 400 before flushing headers', async () => {
    const { res } = createFakeRes();
    const controller = new ChatController(passingService([firstEvent]));

    await expect(
      controller.stream({ sessionId: 'ses_test' }, new EventEmitter() as any, res as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(res.flushHeaders).not.toHaveBeenCalled();
    expect(res.write).not.toHaveBeenCalled();
  });

  it('writes an error frame when the agent stream throws', async () => {
    const { res, written } = createFakeRes();
    const service = {
      async getSession() {
        return { id: 'ses_test', title: '', createdAt: 1, updatedAt: 1, lastMessageAt: null };
      },
      async ensureTitle() {},
      // eslint-disable-next-line require-yield
      async *stream(): AsyncGenerator<ProtocolEvent> {
        throw new Error('provider exploded');
      },
    };
    const controller = new ChatController(service as unknown as ChatService);

    await controller.stream(
      { sessionId: 'ses_test', message: 'hi' },
      new EventEmitter() as any,
      res as any,
    );

    expect(written).toEqual([formatErrorFrame('provider exploded')]);
  });
});

describe('ChatController routes', () => {
  /** An async iterable that yields the given chunks. */
  function chunkStream(chunks: AgentServerChunk[]): AsyncIterable<AgentServerChunk> {
    return {
      [Symbol.asyncIterator]: async function* () {
        for (const chunk of chunks) yield chunk;
      },
    };
  }

  function emptyChunkStream(): AsyncIterable<AgentServerChunk> {
    return chunkStream([]);
  }

  async function createApp() {
    const client = {
      threads: {
        search: vi.fn().mockResolvedValue([threadFixture({ title: 'A session' })]),
        create: vi.fn().mockResolvedValue(threadFixture({ title: '' })),
        get: vi.fn().mockResolvedValue(threadFixture({ title: 'A session' })),
        update: vi.fn().mockResolvedValue(threadFixture({ title: 'A new title' })),
        delete: vi.fn().mockResolvedValue(undefined),
        getState: vi.fn().mockResolvedValue({
          values: {
            messages: [
              { type: 'human', content: 'hi', id: 'm1' },
              { type: 'ai', content: [{ type: 'text', text: 'hello' }], id: 'm2' },
            ],
          },
        }),
      },
      runs: {
        stream: vi.fn().mockReturnValue(emptyChunkStream()),
        list: vi.fn().mockResolvedValue([]),
        cancel: vi.fn().mockResolvedValue(undefined),
      },
    };

    const moduleFixture = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        ChatService,
        { provide: AGENT_SERVER_CLIENT, useValue: client },
      ],
    }).compile();

    const app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    return { app, client };
  }

  it('the list returns the threads as sessions', async () => {
    const { app } = await createApp();
    const response = await request(app.getHttpServer()).get('/v1/chat/sessions');

    expect(response.status).toBe(200);
    expect(response.body.sessions).toHaveLength(1);
    expect(response.body.sessions[0].id).toBe(THREAD_ID);
    expect(response.body.sessions[0].updatedAt).toBe(Date.parse(UPDATED_AT));
    await app.close();
  });

  it('the create returns the new thread id', async () => {
    const { app } = await createApp();
    const response = await request(app.getHttpServer()).post('/v1/chat/sessions');

    expect(response.status).toBe(200);
    expect(response.body.session.id).toBe(THREAD_ID);
    expect(response.body.session.title).toBe('');
    await app.close();
  });

  it('the get returns the session', async () => {
    const { app } = await createApp();
    const response = await request(app.getHttpServer()).get(`/v1/chat/sessions/${THREAD_ID}`);

    expect(response.status).toBe(200);
    expect(response.body.session.title).toBe('A session');
    await app.close();
  });

  it('the rename returns the renamed session', async () => {
    const { app } = await createApp();
    const response = await request(app.getHttpServer())
      .patch(`/v1/chat/sessions/${THREAD_ID}`)
      .send({ title: 'A new title' });

    expect(response.status).toBe(200);
    expect(response.body.session.title).toBe('A new title');
    await app.close();
  });

  it('the delete answers 204', async () => {
    const { app } = await createApp();
    const response = await request(app.getHttpServer()).delete(`/v1/chat/sessions/${THREAD_ID}`);

    expect(response.status).toBe(204);
    await app.close();
  });

  it('the message list maps the thread state to messages', async () => {
    const { app } = await createApp();
    const response = await request(app.getHttpServer()).get(`/v1/chat/sessions/${THREAD_ID}/messages`);

    expect(response.status).toBe(200);
    expect(response.body.messages.map((message: { id: string }) => message.id)).toEqual([
      'm1',
      'm2',
    ]);
    await app.close();
  });

  it('the stop route cancels the runs of the session and answers 204', async () => {
    const { app, client } = await createApp();
    client.runs.list.mockResolvedValue([{ run_id: 'run-1', status: 'running' }]);

    const response = await request(app.getHttpServer()).post(`/v1/chat/sessions/${THREAD_ID}/stop`);

    expect(response.status).toBe(204);
    expect(client.runs.cancel).toHaveBeenCalledWith(THREAD_ID, 'run-1', true, 'interrupt');
    await app.close();
  });

  it('the stop route answers 404 for an unknown session', async () => {
    const { app, client } = await createApp();
    client.runs.list.mockRejectedValue(
      Object.assign(new Error('HTTP 404: Not Found'), { status: 404 }),
    );

    const response = await request(app.getHttpServer()).post('/v1/chat/sessions/ses_missing/stop');

    expect(response.status).toBe(404);
    await app.close();
  });

  it('closing the response does not call runs.cancel', async () => {
    const { app, client } = await createApp();
    const controller = app.get(ChatController);
    const { res, written } = createFakeRes();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    client.runs.stream.mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield { event: 'metadata', data: { run_id: 'run-1' } };
        await gate;
        yield { event: 'messages', data: [{ id: 'ai-1', content: 'late' }, {}] };
      },
    } as AsyncIterable<AgentServerChunk>);

    const pending = controller.stream(
      { sessionId: THREAD_ID, message: 'hi' },
      new EventEmitter() as any,
      res as any,
    );
    await vi.waitFor(() => expect(written).toHaveLength(1));
    res.emit('close');
    release();
    await pending;

    expect(client.runs.cancel).not.toHaveBeenCalled();
    await app.close();
  });
});
