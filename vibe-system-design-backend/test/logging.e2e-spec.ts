import { Writable } from 'node:stream';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Logger, LoggerErrorInterceptor } from 'pino-nestjs';
import request from 'supertest';
import { App } from 'supertest/types.js';

import { AppModule } from './../src/app.module.js';
import { AGENT_CONFIG, DEEP_AGENT } from './../src/agent/agent.provider.js';
import { configureApp } from './../src/app-setup.js';
import { CHAT_REPOSITORY } from './../src/chat/chat.repository.js';
import { FakeChatRepository } from './../src/chat/fake-chat.repository.js';
import { DB_CONNECTION } from './../src/db/db.module.js';
import { buildLoggingParams, setLoggingParams } from './../src/logging/logging-config.js';
import { AppLogger } from './../src/logging/app-logger.js';
import { overrideCheckpointer } from './fake-checkpointer.js';

const lines: string[] = [];

function parse(): Record<string, unknown>[] {
  return lines
    .join('')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function requestLines(): Record<string, unknown>[] {
  return parse().filter((line) => line['logType'] === 'request');
}

describe('logging (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(() => {
    const stream = new Writable({
      write(chunk, _encoding, callback): void {
        lines.push(String(chunk));
        callback();
      },
    });
    setLoggingParams(buildLoggingParams({ NODE_ENV: 'development' }, stream));
  });

  beforeEach(async () => {
    lines.length = 0;
    // The database module and the checkpointer module are overridden too, so
    // the test needs no database and no DATABASE_URL.
    const moduleFixture: TestingModule = await overrideCheckpointer(
      Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(DEEP_AGENT)
        .useValue({ streamEvents: vi.fn() })
        .overrideProvider(AGENT_CONFIG)
        .useValue({ baseURL: 'http://localhost', apiKey: 'test', model: 'test' })
        .overrideProvider(CHAT_REPOSITORY)
        .useValue(new FakeChatRepository())
        .overrideProvider(DB_CONNECTION)
        .useValue({ db: {}, close: async () => {} }),
    ).compile();

    app = moduleFixture.createNestApplication();
    app.useLogger(app.get(Logger));
    app.useGlobalInterceptors(new LoggerErrorInterceptor());
    configureApp(app);
    await app.init();
  });

  it('prints one request line for one request', async () => {
    await request(app.getHttpServer()).get('/v1').expect(200);

    await vi.waitFor(() => expect(requestLines()).toHaveLength(1));
    const [line] = requestLines();

    expect(line?.['method']).toBe('GET');
    expect(line?.['path']).toBe('/v1');
    expect(line?.['statusCode']).toBe(200);
    expect(line?.['userId']).toBeNull();
    expect(line?.['err']).toBeNull();
    expect(String(line?.['requestId'])).toMatch(/^req_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(String(line?.['traceId'])).toMatch(/^trace_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(typeof line?.['durationMs']).toBe('number');
  });

  it('echoes the trace id of the header and reuses it in the request line', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1')
      .set('x-trace-id', 'abc12345')
      .expect(200);

    expect(response.headers['x-trace-id']).toBe('abc12345');
    await vi.waitFor(() => expect(requestLines()).toHaveLength(1));
    expect(requestLines()[0]?.['traceId']).toBe('abc12345');
  });

  it('replaces an invalid trace id header with a fresh trace id', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1')
      .set('x-trace-id', 'bad value')
      .expect(200);

    expect(response.headers['x-trace-id']).toMatch(/^trace_[0-9A-HJKMNP-TV-Z]{26}$/);
    await vi.waitFor(() => expect(requestLines()).toHaveLength(1));
    expect(requestLines()[0]?.['traceId']).toBe(response.headers['x-trace-id']);
  });

  it('prints no request line for a preflight request', async () => {
    await request(app.getHttpServer())
      .options('/v1')
      .set('access-control-request-method', 'GET');

    // A preflight request writes no request line and no app line.
    // We verify by checking that no request line exists after a short pause.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(requestLines()).toEqual([]);
  });

  it('prints the error of a failed request under the err key', async () => {
    await request(app.getHttpServer()).get('/v1/chat/sessions/ses_missing').expect(404);

    await vi.waitFor(() => expect(requestLines()).toHaveLength(1));
    const [line] = requestLines();
    const err = line?.['err'] as Record<string, unknown>;

    expect(line?.['level']).toBe('warn');
    expect(line?.['statusCode']).toBe(404);
    expect(String(err['message'])).toContain('ses_missing');
  });

  it('prints the lifecycle lines as JSON', async () => {
    new AppLogger('Test').info('Nest application successfully started');
    await vi.waitFor(() =>
      expect(
        parse().some(
          (line) =>
            line['logType'] === 'app' &&
            String(line['message']).includes('Nest application successfully started'),
        ),
      ).toBe(true),
    );
  });

  afterEach(async () => {
    await app.close();
  });
});
