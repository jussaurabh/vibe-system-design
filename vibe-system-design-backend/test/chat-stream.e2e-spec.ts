import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SystemMessage } from '@langchain/core/messages';
import type { ProtocolEvent } from '@langchain/langgraph';
import { AppModule } from '../src/app.module.js';
import { AGENT_CONFIG, DEEP_AGENT } from '../src/agent/agent.provider.js';
import { configureApp } from '../src/app-setup.js';
import { formatDoneFrame, formatErrorFrame, formatEventFrame } from '../src/chat/sse.js';

const events: ProtocolEvent[] = [
  { type: 'event', seq: 1, method: 'messages', params: { namespace: [], timestamp: 0, data: { event: 'message-start' } } },
  { type: 'event', seq: 2, method: 'messages', params: { namespace: [], timestamp: 1, data: { event: 'content-block-delta', delta: { type: 'text-delta', text: 'hi' } } } },
];

function deepAgentStub(eventsOrError: ProtocolEvent[] | Error) {
  return {
    streamEvents: vi.fn(async () => ({
      [Symbol.asyncIterator]: async function* () {
        if (eventsOrError instanceof Error) throw eventsOrError;
        for (const event of eventsOrError) yield event;
      },
    })),
  };
}

async function createApp(agent: unknown) {
  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DEEP_AGENT)
    .useValue(agent)
    .overrideProvider(AGENT_CONFIG)
    .useValue({ baseURL: 'http://localhost', apiKey: 'test', model: 'test' })
    .compile();
  const app = moduleFixture.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

describe('POST /v1/chat/stream (e2e)', () => {
  it('streams allow-listed v3 protocol events then a done frame', async () => {
    const app = await createApp(deepAgentStub(events));
    const response = await request(app.getHttpServer())
      .post('/v1/chat/stream')
      .send({ messages: [{ role: 'user', content: 'hi' }] });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.headers['cache-control']).toBe('no-cache, no-transform');
    expect(response.text).toBe(
      `${events.map(formatEventFrame).join('')}${formatDoneFrame()}`,
    );
    await app.close();
  });

  it('forwards only allow-listed events to the browser', async () => {
    const allowed = [
      {
        type: 'event',
        seq: 0,
        method: 'lifecycle',
        params: { namespace: [], timestamp: 0, data: { event: 'running', graph_name: 'root' } },
      },
      {
        type: 'event',
        seq: 1,
        method: 'messages',
        params: {
          namespace: [],
          timestamp: 1,
          data: { event: 'content-block-delta', delta: { type: 'text-delta', text: 'hi' } },
        },
      },
      {
        type: 'event',
        seq: 2,
        method: 'tasks',
        params: {
          namespace: [],
          timestamp: 2,
          data: { id: 't1', name: 'model_request', result: {}, interrupts: [] },
        },
      },
      {
        type: 'event',
        seq: 3,
        method: 'lifecycle',
        params: { namespace: [], timestamp: 3, data: { event: 'completed', graph_name: 'root' } },
      },
    ] as ProtocolEvent[];
    const blocked = {
      type: 'event',
      seq: 4,
      method: 'values',
      params: { namespace: [], timestamp: 4, data: { messages: [] } },
    } as ProtocolEvent;

    const app = await createApp(deepAgentStub([...allowed, blocked]));
    const response = await request(app.getHttpServer())
      .post('/v1/chat/stream')
      .send({ messages: [{ role: 'user', content: 'hi' }] });

    expect(response.text).toBe(`${allowed.map(formatEventFrame).join('')}${formatDoneFrame()}`);
    expect(response.text).not.toContain('"method":"values"');
    await app.close();
  });

  it('returns 400 and no stream for an invalid body', async () => {
    const app = await createApp(deepAgentStub(events));
    const response = await request(app.getHttpServer())
      .post('/v1/chat/stream')
      .send({ messages: [] });

    expect(response.status).toBe(400);
    expect(response.headers['content-type']).not.toContain('text/event-stream');
    await app.close();
  });

  it('emits an error frame and terminates when the agent fails mid-stream', async () => {
    const app = await createApp(deepAgentStub(new Error('model not found')));
    const response = await request(app.getHttpServer())
      .post('/v1/chat/stream')
      .send({ messages: [{ role: 'user', content: 'hi' }] });

    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.text).toBe(formatErrorFrame('model not found'));
    await app.close();
  });

  it('forwards a system-only conversation to the agent', async () => {
    const agent = deepAgentStub(events);
    const app = await createApp(agent);
    await request(app.getHttpServer())
      .post('/v1/chat/stream')
      .send({ messages: [{ role: 'system', content: 'be nice' }] });

    expect(agent.streamEvents).toHaveBeenCalledWith(
      { messages: [expect.any(SystemMessage)] },
      expect.objectContaining({ version: 'v3' }),
    );
    await app.close();
  });

  it('answers the CORS preflight request for an allowed origin', async () => {
    const app = await createApp(deepAgentStub(events));
    const response = await request(app.getHttpServer())
      .options('/v1/chat/stream')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(
      'http://localhost:5173',
    );
    expect(response.headers['access-control-allow-methods']).toContain('POST');
    await app.close();
  });

  it('sends the CORS header on the stream response', async () => {
    const app = await createApp(deepAgentStub(events));
    const response = await request(app.getHttpServer())
      .post('/v1/chat/stream')
      .set('Origin', 'http://localhost:5173')
      .send({ messages: [{ role: 'user', content: 'hi' }] });

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe(
      'http://localhost:5173',
    );
    await app.close();
  });

  it('sends no CORS header for an origin that is not allowed', async () => {
    const app = await createApp(deepAgentStub(events));
    const response = await request(app.getHttpServer())
      .post('/v1/chat/stream')
      .set('Origin', 'http://evil.test')
      .send({ messages: [{ role: 'user', content: 'hi' }] });

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });
});
