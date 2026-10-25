import { describe, expect, it } from 'vitest';

import {
  createRequestContext,
  currentRequestContext,
  runInRequestContext,
} from './request-context.js';

describe('request context', () => {
  it('keeps the context inside the run and hides it outside', () => {
    const context = createRequestContext('req_1', 'trace_1');

    expect(currentRequestContext()).toBeUndefined();
    expect(runInRequestContext(context, () => currentRequestContext())).toBe(context);
    expect(currentRequestContext()).toBeUndefined();
  });

  it('counts the log lines of one request from one', () => {
    const context = createRequestContext('req_1', 'trace_1');

    expect([context.nextSeq(), context.nextSeq(), context.nextSeq()]).toEqual([1, 2, 3]);
  });

  it('gives every request its own counter', () => {
    const first = createRequestContext('req_1', 'trace_1');
    const second = createRequestContext('req_2', 'trace_2');
    first.nextSeq();
    first.nextSeq();

    expect(second.nextSeq()).toBe(1);
  });

  it('keeps the context inside an awaited promise', async () => {
    const context = createRequestContext('req_1', 'trace_1');

    const awaited = await runInRequestContext(context, async () => {
      await Promise.resolve();
      return currentRequestContext();
    });

    expect(awaited).toBe(context);
  });
});
