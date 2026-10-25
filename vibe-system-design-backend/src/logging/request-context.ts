import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  readonly requestId: string;
  readonly traceId: string;
  nextSeq(): number;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function createRequestContext(requestId: string, traceId: string): RequestContext {
  let seq = 0;
  return {
    requestId,
    traceId,
    nextSeq: () => ++seq,
  };
}

export function runInRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
