import { EventEmitter } from 'node:events';

import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { ProtocolEvent } from '@langchain/langgraph';
import type { Thread } from '@langchain/langgraph-sdk';
import request from 'supertest';

import { AGENT_SERVER_CLIENT } from '../agent-server/agent-server.module.js';
import { DEEP_AGENT } from '../agent/agent.provider.js';
import { ChatController } from './chat.controller.js';
import { CHAT_REPOSITORY } from './chat.repository.js';
import { ChatService } from './chat.service.js';
import { FakeChatRepository } from './fake-chat.repository.js';
import { formatDoneFrame, formatErrorFrame, formatEventFrame } from '../utils/sse.js';

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

  it('aborts the agent and stops writing when the response closes mid-stream', async () => {
    const { res, written } = createFakeRes();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const seen: AbortSignal[] = [];
    const service = {
      async getSession() {
        return { id: 'ses_test', title: '', createdAt: 1, updatedAt: 1, lastMessageAt: null };
      },
      async *stream(_sessionId: string, _message: string, signal: AbortSignal) {
        seen.push(signal);
        yield firstEvent;
        await gate;
        yield { ...firstEvent, seq: 2 } as ProtocolEvent;
      },
    };
    const controller = new ChatController(service as unknown as ChatService);

    const pending = controller.stream(
      { sessionId: 'ses_test', message: 'hi' },
      new EventEmitter() as any,
      res as any,
    );
    await vi.waitFor(() => expect(written).toHaveLength(1));
    res.emit('close');
    release();
    await pending;

    expect(seen[0]?.aborted).toBe(true);
    expect(written).toEqual([formatEventFrame(firstEvent)]);
  });

  it('writes an error frame when the agent stream throws', async () => {
    const { res, written } = createFakeRes();
    const service = {
      async getSession() {
        return { id: 'ses_test', title: '', createdAt: 1, updatedAt: 1, lastMessageAt: null };
      },
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
  async function createApp() {
    const repository = new FakeChatRepository();
    // The row exists for the message routes only. The session routes read
    // threads from the Agent Server client.
    repository.addSession({
      id: THREAD_ID,
      title: 'A session',
      createdAt: 1000,
      updatedAt: 1000,
      lastMessageAt: null,
    });
    repository.addMessage({
      id: 'msg_test',
      sessionId: THREAD_ID,
      createdAt: 1001,
      seq: 1,
      senderType: 'user',
      content: [{ type: 'text', text: 'hi' }],
      status: 'complete',
      tokenCount: null,
      modelName: null,
      latencyMs: null,
    });

    const client = {
      threads: {
        search: vi.fn().mockResolvedValue([threadFixture({ title: 'A session' })]),
        create: vi.fn().mockResolvedValue(threadFixture({ title: '' })),
        get: vi.fn().mockResolvedValue(threadFixture({ title: 'A session' })),
        update: vi.fn().mockResolvedValue(threadFixture({ title: 'A new title' })),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    };

    const moduleFixture = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        ChatService,
        { provide: CHAT_REPOSITORY, useValue: repository },
        {
          provide: DEEP_AGENT,
          useValue: {
            modelName: 'test-model',
            streamEvents: vi.fn().mockResolvedValue({
              [Symbol.asyncIterator]: async function* () {
                // The routes never run the agent.
              },
            }),
          },
        },
        { provide: AGENT_SERVER_CLIENT, useValue: client },
      ],
    }).compile();

    const app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    return { app, repository };
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
    expect(response.body.session.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
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

  it('the message list returns the messages', async () => {
    const { app } = await createApp();
    const response = await request(app.getHttpServer()).get(`/v1/chat/sessions/${THREAD_ID}/messages`);

    expect(response.status).toBe(200);
    expect(response.body.messages).toHaveLength(1);
    expect(response.body.messages[0].id).toBe('msg_test');
    await app.close();
  });

  it('the message delete answers 204', async () => {
    const { app } = await createApp();
    const response = await request(app.getHttpServer()).delete('/v1/chat/messages/msg_test');

    expect(response.status).toBe(204);
    await app.close();
  });
});
