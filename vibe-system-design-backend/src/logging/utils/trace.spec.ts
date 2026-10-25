import { describe, expect, it } from 'vitest';

import { createRequestContext, runInRequestContext } from '../request-context.js';
import {
  isValidTraceId,
  newRequestId,
  newTraceId,
  traceHeaders,
} from './trace.js';

describe('correlation ids', () => {
  it('prefixes the request id with req_ and the trace id with trace_', () => {
    expect(newRequestId()).toMatch(/^req_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(newTraceId()).toMatch(/^trace_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('never repeats an id inside one process', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newRequestId()));

    expect(ids.size).toBe(1000);
  });

  it('accepts a trace id of 8 to 64 letters, digits, dashes, and underscores', () => {
    expect(isValidTraceId('abc12345')).toBe(true);
    expect(isValidTraceId(`a-b_${'0'.repeat(60)}`)).toBe(true);
  });

  it('rejects a trace id that is too short, too long, or holds other characters', () => {
    expect(isValidTraceId('short')).toBe(false);
    expect(isValidTraceId('a'.repeat(65))).toBe(false);
    expect(isValidTraceId('has space')).toBe(false);
    expect(isValidTraceId('line\nbreak')).toBe(false);
  });

  it('returns the trace header of the running request', () => {
    const context = createRequestContext('req_1', 'trace_1');

    expect(runInRequestContext(context, () => traceHeaders())).toEqual({ 'x-trace-id': 'trace_1' });
  });

  it('returns no trace header outside a request', () => {
    expect(traceHeaders()).toEqual({});
  });
});
