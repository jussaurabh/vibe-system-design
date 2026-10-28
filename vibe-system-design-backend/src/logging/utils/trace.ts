import { randomUUID } from 'node:crypto';

import { currentRequestContext } from '../request-context.js';

export const TRACE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export function newRequestId(): string {
  return `req_${randomUUID()}`;
}

export function newTraceId(): string {
  return `trace_${randomUUID()}`;
}

export function isValidTraceId(value: string): boolean {
  return TRACE_ID_PATTERN.test(value);
}

export function traceHeaders(): Record<string, string> {
  const context = currentRequestContext();
  return context === undefined ? {} : { 'x-trace-id': context.traceId };
}
