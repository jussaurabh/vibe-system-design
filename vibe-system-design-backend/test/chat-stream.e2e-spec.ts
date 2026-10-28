import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Thread } from '@langchain/langgraph-sdk';

import { AppModule } from '../src/app.module.js';
import { AGENT_CONFIG, DEEP_AGENT } from '../src/agent/agent.provider.js';
import { configureApp } from '../src/app-setup.js';
import { AGENT_SERVER_CONFIG } from '../src/agent-server/agent-server.config.js';
import { AGENT_SERVER_CLIENT } from '../src/agent-server/agent-server.module.js';
import {
  CHECKPOINTER_CONFIG,
  PG_POOL,
  POSTGRES_CHECKPOINTER,
} from '../src/checkpointer/checkpointer.provider.js';
import type { AgentServerChunk } from '../src/chat/protocol-adapter.js';
import type { ProtocolEvent } from '../src/utils/protocol-event.js';
import { DB_CONNECTION } from '../src/db/db.module.js';
import { formatDoneFrame, formatErrorFrame, formatEventFrame } from '../src/utils/sse.js';

const SESSION_ID = 'ses_test';
const API_URL = 'http://localhost:2024';

/** The Task 2 Case A chunk sequence, plus one updates chunk before flush. */
const CHUNKS: AgentServerChunk[] = [
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
  { event: 'updates', data: { model: { messages: [] } } },
];

/** The error the Agent Server throws for a missing thread. */
function notFound(): Error {
  return Object.assign(new Error('HTTP 404: Not Found'), { status: 404 });
}

function threadFixture(): Thread {
  return {
    thread_id: SESSION_ID,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
    state_updated_at: '2026-01-02T00:00:00.000Z',
    metadata: { title: 'A session' },
    status: 'idle',
    values: {},
    interrupts: {},
  };
}

/** An async iterable that yields the given chunks. */
function chunkStream(chunks: AgentServerChunk[]): AsyncIterable<AgentServerChunk> {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of chunks) yield chunk;
    },
  };
}

function fakeClient() {
  return {
    threads: {
      get: vi.fn().mockResolvedValue(threadFixture()),
      update: vi.fn().mockResolvedValue(threadFixture()),
    },
    runs: {
      stream: vi.fn().mockReturnValue(chunkStream(CHUNKS)),
      cancel: vi.fn().mockResolvedValue(undefined),
    },
  };
}

async function createApp(client = fakeClient()) {
  // The database, agent, and checkpointer modules still bootstrap until
  // Task 5, so the test overrides them instead of the real dependencies.
  // The checkpointer stubs are inline: fake-checkpointer.ts dies in Task 5.
  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DEEP_AGENT)
    .useValue({ streamEvents: vi.fn() })
    .overrideProvider(AGENT_CONFIG)
    .useValue({ baseURL: 'http://localhost', apiKey: 'test', model: 'test' })
    .overrideProvider(AGENT_SERVER_CONFIG)
    .useValue({ apiUrl: API_URL })
    .overrideProvider(AGENT_SERVER_CLIENT)
    .useValue(client)
    .overrideProvider(DB_CONNECTION)
    .useValue({ db: {}, close: async () => {} })
    .overrideProvider(CHECKPOINTER_CONFIG)
    .useValue({ connectionString: 'postgres://fake', schema: 'fake' })
    .overrideProvider(POSTGRES_CHECKPOINTER)
    .useValue({ deleteThread: vi.fn(), getTuple: vi.fn(), setup: vi.fn() })
    .overrideProvider(PG_POOL)
    .useValue({ end: async () => {} })
    .compile();
  const app = moduleFixture.createNestApplication();
  configureApp(app);
  await app.init();
  return { app, client };
}

describe('POST /v1/chat/stream (e2e)', () => {
  it('proxies the agent server run as SSE frames then a done frame', async () => {
    const { app, client } = await createApp();
    const response = await request(app.getHttpServer())
      .post('/v1/chat/stream')
      .send({ sessionId: SESSION_ID, message: 'hi' });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.headers['cache-control']).toBe('no-cache, no-transform');
    expect(client.runs.stream).toHaveBeenCalledWith(SESSION_ID, 'agent', {
      input: { messages: [{ role: 'user', content: 'hi' }] },
      streamMode: ['messages-tuple', 'updates'],
    });

    const frames = response.text
      .split('\n\n')
      .filter((part) => part.startsWith('data: '))
      .map((part) => JSON.parse(part.slice('data: '.length)) as ProtocolEvent);

    // The updates frame lands between the deltas and the flush frames: the
    // adapter emits the close frames only when the stream ends.
    expect(frames.map((frame) => frame.method)).toEqual([
      'lifecycle',
      'messages',
      'messages',
      'messages',
      'messages',
      'updates',
      'messages',
      'messages',
      'lifecycle',
    ]);
    frames.forEach((frame, index) => {
      expect(frame.type).toBe('event');
      expect(frame.seq).toBe(index);
      expect(frame.params.namespace).toEqual([]);
      expect(typeof frame.params.timestamp).toBe('number');
    });

    const deltas = frames
      .map((frame) => frame.params.data as Record<string, unknown>)
      .filter((data) => data['event'] === 'content-block-delta')
      .map((data) => (data['delta'] as Record<string, unknown>)['text']);
    expect(deltas).toEqual(['Hello', ' world']);

    const finish = frames
      .map((frame) => frame.params.data as Record<string, unknown>)
      .find((data) => data['event'] === 'message-finish');
    expect(finish?.['usage']).toEqual({
      input_tokens: 5,
      output_tokens: 7,
      total_tokens: 12,
    });

    expect(response.text).toBe(
      `${frames.map(formatEventFrame).join('')}${formatDoneFrame()}`,
    );
    await app.close();
  });

  it('returns 400 and no stream for an invalid body', async () => {
    const { app } = await createApp();
    const response = await request(app.getHttpServer())
      .post('/v1/chat/stream')
      .send({ sessionId: SESSION_ID });

    expect(response.status).toBe(400);
    expect(response.headers['content-type']).not.toContain('text/event-stream');
    await app.close();
  });

  it('answers 404 and never starts the run for an unknown session id', async () => {
    const client = fakeClient();
    client.threads.get.mockRejectedValue(notFound());
    const { app } = await createApp(client);
    const response = await request(app.getHttpServer())
      .post('/v1/chat/stream')
      .send({ sessionId: 'ses_missing', message: 'hi' });

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).not.toContain('text/event-stream');
    expect(client.runs.stream).not.toHaveBeenCalled();
    await app.close();
  });

  it('emits an error frame and terminates when the run fails mid-stream', async () => {
    const client = fakeClient();
    client.runs.stream.mockReturnValue({
      // eslint-disable-next-line require-yield
      [Symbol.asyncIterator]: async function* () {
        throw new Error('model not found');
      },
    } as AsyncIterable<AgentServerChunk>);
    const { app } = await createApp(client);
    const response = await request(app.getHttpServer())
      .post('/v1/chat/stream')
      .send({ sessionId: SESSION_ID, message: 'hi' });

    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.text).toBe(formatErrorFrame('model not found'));
    await app.close();
  });

  it('answers the CORS preflight request for an allowed origin', async () => {
    const { app } = await createApp();
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
    const { app } = await createApp();
    const response = await request(app.getHttpServer())
      .post('/v1/chat/stream')
      .set('Origin', 'http://localhost:5173')
      .send({ sessionId: SESSION_ID, message: 'hi' });

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe(
      'http://localhost:5173',
    );
    await app.close();
  });

  it('sends no CORS header for an origin that is not allowed', async () => {
    const { app } = await createApp();
    const response = await request(app.getHttpServer())
      .post('/v1/chat/stream')
      .set('Origin', 'http://evil.test')
      .send({ sessionId: SESSION_ID, message: 'hi' });

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });
});

describe('POST /v1/chat/sessions/:sessionId/stop (e2e)', () => {
  it('cancels the runs of the session through the agent server API', async () => {
    const { app, client } = await createApp();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app.getHttpServer())
      .post(`/v1/chat/sessions/${SESSION_ID}/stop`)
      .send();

    expect(response.status).toBe(204);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/threads/${SESSION_ID}/runs/cancel`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'interrupt' }),
      }),
    );
    expect(client.runs.cancel).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    await app.close();
  });
});
