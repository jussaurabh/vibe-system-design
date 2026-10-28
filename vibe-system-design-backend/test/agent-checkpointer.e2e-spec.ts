import { Test } from '@nestjs/testing';

import { AGENT_CONFIG, DEEP_AGENT } from '../src/agent/agent.provider.js';
import type { StreamableAgent } from '../src/agent/agent.provider.js';
import { AppModule } from '../src/app.module.js';
import { AGENT_SERVER_CONFIG } from '../src/agent-server/agent-server.config.js';
import { DB_CONNECTION } from '../src/db/db.module.js';
import {
  createFakeCheckpointer,
  overrideCheckpointer,
} from './fake-checkpointer.js';
import type { FakeCheckpointer } from './fake-checkpointer.js';

// The database, repository, and checkpointer are overridden, so the test
// needs no database and no DATABASE_URL.
async function createApp(checkpointer?: FakeCheckpointer) {
  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AGENT_CONFIG)
    .useValue({
      baseURL: 'http://localhost',
      apiKey: 'test',
      model: 'test-model',
    })
    .overrideProvider(AGENT_SERVER_CONFIG)
    .useValue({ apiUrl: 'http://localhost:2024' })
    .overrideProvider(DB_CONNECTION)
    .useValue({ db: {}, close: async () => {} });
  const moduleFixture = await (
    checkpointer
      ? overrideCheckpointer(builder, checkpointer)
      : overrideCheckpointer(builder)
  ).compile();
  const app = moduleFixture.createNestApplication();
  await app.init();
  return app;
}

describe('DEEP_AGENT checkpointer wiring (e2e)', () => {
  it('builds the real agent with the model from AGENT_CONFIG', async () => {
    const app = await createApp();

    const agent = app.get<StreamableAgent>(DEEP_AGENT);
    expect(agent.modelName).toBe('test-model');
    expect(typeof agent.streamEvents).toBe('function');
    await app.close();
  });

  it('loads graph state through the injected checkpointer', async () => {
    const fake = createFakeCheckpointer();
    fake.getTuple.mockResolvedValue(undefined);
    const app = await createApp(fake);

    const agent = app.get<StreamableAgent>(DEEP_AGENT);
    // The model base URL is unreachable, so the run fails; the point is that
    // the graph reads its checkpoint through the injected checkpointer.
    try {
      const run = await agent.streamEvents(
        { messages: [] },
        {
          version: 'v3',
          configurable: { thread_id: 't' },
          signal: new AbortController().signal,
        },
      );
      await run[Symbol.asyncIterator]().next();
    } catch {
      // Expected: the run fails against the unreachable model endpoint.
    }
    expect(fake.getTuple).toHaveBeenCalled();
    await app.close();
  });
});
