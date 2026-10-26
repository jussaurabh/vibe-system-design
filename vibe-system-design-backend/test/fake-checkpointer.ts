import type { TestingModuleBuilder } from '@nestjs/testing';

import type { CheckpointerConfig } from '../src/checkpointer/checkpointer.config.js';
import {
  CHECKPOINTER_CONFIG,
  PG_POOL,
  POSTGRES_CHECKPOINTER,
} from '../src/checkpointer/checkpointer.provider.js';

export interface FakeCheckpointer {
  deleteThread: ReturnType<typeof vi.fn>;
  getTuple: ReturnType<typeof vi.fn>;
  setup: ReturnType<typeof vi.fn>;
}

export function createFakeCheckpointer(): FakeCheckpointer {
  return {
    deleteThread: vi.fn(),
    getTuple: vi.fn(),
    setup: vi.fn(),
  };
}

/**
 * Point the checkpointer module at an in memory fake and a closed pool stub,
 * so the e2e suite never builds a real Postgres pool and needs no DATABASE_URL.
 */
export function overrideCheckpointer(
  builder: TestingModuleBuilder,
  checkpointer: FakeCheckpointer = createFakeCheckpointer(),
): TestingModuleBuilder {
  return builder
    .overrideProvider(CHECKPOINTER_CONFIG)
    .useValue({
      connectionString: 'postgres://fake',
      schema: 'fake',
    } satisfies CheckpointerConfig)
    .overrideProvider(POSTGRES_CHECKPOINTER)
    .useValue(checkpointer)
    .overrideProvider(PG_POOL)
    .useValue({ end: async () => {} });
}
