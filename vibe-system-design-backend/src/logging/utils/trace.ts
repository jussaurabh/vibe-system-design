import { monotonicFactory } from 'ulid';

import { currentRequestContext } from '../request-context.js';

const ulid = monotonicFactory();

export const TRACE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export function newRequestId(): string {
  return `req_${ulid()}`;
}

export function newTraceId(): string {
  return `trace_${ulid()}`;
}

export function isValidTraceId(value: string): boolean {
  return TRACE_ID_PATTERN.test(value);
}

export function traceHeaders(): Record<string, string> {
  const context = currentRequestContext();
  return context === undefined ? {} : { 'x-trace-id': context.traceId };
}
