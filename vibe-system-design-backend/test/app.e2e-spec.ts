import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { AGENT_CONFIG, DEEP_AGENT } from './../src/agent/agent.provider.js';
import { configureApp } from './../src/app-setup.js';
import { CHAT_REPOSITORY } from './../src/chat/chat.repository.js';
import { FakeChatRepository } from './../src/chat/fake-chat.repository.js';
import { DB_CONNECTION } from './../src/db/db.module.js';
import { overrideCheckpointer } from './fake-checkpointer.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    // The database module and the checkpointer module are overridden too, so
    // the test needs no database and no DATABASE_URL.
    const moduleFixture: TestingModule = await overrideCheckpointer(
      Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(DEEP_AGENT)
        .useValue({ streamEvents: vi.fn() })
        .overrideProvider(AGENT_CONFIG)
        .useValue({
          baseURL: 'http://localhost',
          apiKey: 'test',
          model: 'test',
        })
        .overrideProvider(CHAT_REPOSITORY)
        .useValue(new FakeChatRepository())
        .overrideProvider(DB_CONNECTION)
        .useValue({ db: {}, close: async () => {} }),
    ).compile();

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
