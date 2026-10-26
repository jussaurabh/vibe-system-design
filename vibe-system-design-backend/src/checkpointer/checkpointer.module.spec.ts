import { Test } from '@nestjs/testing';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

import { AI_CHAT_SCHEMA } from '../db/schema.js';

import type { CheckpointerConfig } from './checkpointer.config.js';
import {
  CHECKPOINTER_CONFIG,
  POSTGRES_CHECKPOINTER,
} from './checkpointer.provider.js';

import { CheckpointerModule } from './checkpointer.module.js';

// One stub pool serves every consumer in the compiled module. `connect` covers
// PostgresSaver.setup(), `on` covers the idle-client error listener, `end`
// covers the module destroy lifecycle.
const poolStub = vi.hoisted(() => {
  return {
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    connect: vi.fn(async () => ({
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    })),
    on: vi.fn(),
    end: vi.fn(async () => undefined),
  };
});

vi.mock('pg', () => {
  return {
    Pool: class PgPoolStub {
      query = poolStub.query;
      connect = poolStub.connect;
      on = poolStub.on;
      end = poolStub.end;
    },
  };
});

const config: CheckpointerConfig = {
  connectionString: 'postgres://localhost:5432/checkpoint',
  schema: AI_CHAT_SCHEMA,
};

function compileModule() {
  return Test.createTestingModule({ imports: [CheckpointerModule] })
    .overrideProvider(CHECKPOINTER_CONFIG)
    .useValue(config)
    .compile();
}

describe('CheckpointerModule', () => {
  it('resolves POSTGRES_CHECKPOINTER to a set-up PostgresSaver backed by the pg pool', async () => {
    const moduleBuilder = await compileModule();

    const checkpointer = await moduleBuilder.resolve(POSTGRES_CHECKPOINTER);

    expect(checkpointer).toBeInstanceOf(PostgresSaver);
    expect(poolStub.connect).toHaveBeenCalled();
    expect(poolStub.on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('ends the pool on module destroy', async () => {
    const moduleBuilder = await compileModule();
    const instance = moduleBuilder.get(CheckpointerModule);

    await instance.onModuleDestroy();

    expect(poolStub.end).toHaveBeenCalledTimes(1);
  });
});
