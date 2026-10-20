import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { AGENT_CONFIG, DEEP_AGENT } from './../src/agent/agent.provider.js';
import { configureApp } from './../src/app-setup.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DEEP_AGENT)
      .useValue({ streamEvents: vi.fn() })
      .overrideProvider(AGENT_CONFIG)
      .useValue({ baseURL: 'http://localhost', apiKey: 'test', model: 'test' })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  it('/v1 (GET)', () => {
    return request(app.getHttpServer())
      .get('/v1')
      .expect(200)
      .expect('Hello World!');
  });

  afterEach(async () => {
    await app.close();
  });
});
