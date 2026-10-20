import { EventEmitter } from 'node:events';

import { BadRequestException } from '@nestjs/common';
import type { BaseMessage } from '@langchain/core/messages';
import type { ProtocolEvent } from '@langchain/langgraph';

import { ChatController } from './chat.controller.js';
import type { ChatService } from './chat.service.js';
import { formatDoneFrame, formatErrorFrame, formatEventFrame } from './sse.js';

function passingService(events: ProtocolEvent[]) {
  return {
    async *stream() {
      for (const event of events) yield event;
    },
  } as unknown as ChatService;
}

function createFakeRes() {
  const written: string[] = [];
  const res = Object.assign(new EventEmitter(), {
    writableEnded: false,
    writableFinished: false,
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn((chunk: string) => {
      written.push(chunk);
      return true;
    }),
    end: vi.fn(() => {
      res.writableEnded = true;
      res.writableFinished = true;
    }),
  });
  return { res, written };
}

const firstEvent = { type: 'event', seq: 1, method: 'messages', params: {} } as ProtocolEvent;

describe('ChatController', () => {
  it('writes headers, one frame per event, then a done frame', async () => {
    const { res, written } = createFakeRes();
    const controller = new ChatController(passingService([firstEvent]));
    const req = new EventEmitter();

    await controller.stream({ messages: [{ role: 'user', content: 'hi' }] }, req as any, res as any);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(res.flushHeaders).toHaveBeenCalledOnce();
    expect(written).toEqual([formatEventFrame(firstEvent), formatDoneFrame()]);
  });

  it('rejects an invalid body with 400 before flushing headers', async () => {
    const { res } = createFakeRes();
    const controller = new ChatController(passingService([firstEvent]));

    await expect(
      controller.stream({ messages: [] }, new EventEmitter() as any, res as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(res.flushHeaders).not.toHaveBeenCalled();
    expect(res.write).not.toHaveBeenCalled();
  });

  it('aborts the agent and stops writing when the response closes mid-stream', async () => {
    const { res, written } = createFakeRes();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const seen: AbortSignal[] = [];
    const service = {
      async *stream(_messages: BaseMessage[], signal: AbortSignal) {
        seen.push(signal);
        yield firstEvent;
        await gate;
        yield { ...firstEvent, seq: 2 } as ProtocolEvent;
      },
    };
    const controller = new ChatController(service as unknown as ChatService);

    const pending = controller.stream(
      { messages: [{ role: 'user', content: 'hi' }] },
      new EventEmitter() as any,
      res as any,
    );
    await vi.waitFor(() => expect(written).toHaveLength(1));
    res.emit('close');
    release();
    await pending;

    expect(seen[0]?.aborted).toBe(true);
    expect(written).toEqual([formatEventFrame(firstEvent)]);
  });

  it('writes an error frame when the agent stream throws', async () => {
    const { res, written } = createFakeRes();
    const service = {
      // eslint-disable-next-line require-yield
      async *stream(): AsyncGenerator<ProtocolEvent> {
        throw new Error('provider exploded');
      },
    };
    const controller = new ChatController(service as unknown as ChatService);

    await controller.stream(
      { messages: [{ role: 'user', content: 'hi' }] },
      new EventEmitter() as any,
      res as any,
    );

    expect(written).toEqual([formatErrorFrame('provider exploded')]);
  });
});
