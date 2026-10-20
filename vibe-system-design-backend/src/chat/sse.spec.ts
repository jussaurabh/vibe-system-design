import type { ProtocolEvent } from '@langchain/langgraph';
import { describe, expect, it } from 'vitest';
import { SSE_HEADERS, formatDoneFrame, formatErrorFrame, formatEventFrame } from './sse.js';

const event: ProtocolEvent = {
  type: 'event',
  seq: 1,
  method: 'messages',
  params: { namespace: [], timestamp: 0, data: { event: 'content-block-delta' } },
};

describe('sse frames', () => {
  it('wraps a protocol event as a default SSE message', () => {
    expect(formatEventFrame(event)).toBe(`data: ${JSON.stringify(event)}\n\n`);
  });

  it('formats the done frame', () => {
    expect(formatDoneFrame()).toBe('event: done\ndata: {}\n\n');
  });

  it('formats the error frame', () => {
    expect(formatErrorFrame('boom')).toBe('event: error\ndata: {"message":"boom"}\n\n');
  });

  it('exposes headers that disable proxy buffering', () => {
    expect(SSE_HEADERS).toMatchObject({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
  });
});
