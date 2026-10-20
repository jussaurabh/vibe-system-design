/**
 * Helpers that build a fake `text/event-stream` response for the chat tests.
 */
import { vi } from "vitest";

/** A controllable SSE stream. A test pushes frames and closes the stream. */
export interface SseStream {
  readonly body: ReadableStream<Uint8Array>;
  push(chunk: string): void;
  close(): void;
  abort(): void;
}

const encoder = new TextEncoder();

/** Create an SSE stream that the test drives. */
export function createSseStream(): SseStream {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    body,
    push(chunk: string) {
      controller?.enqueue(encoder.encode(chunk));
    },
    close() {
      try {
        controller?.close();
      } catch {
        // The stream already ended.
      }
    },
    abort() {
      try {
        controller?.error(
          new DOMException("The stream was aborted.", "AbortError"),
        );
      } catch {
        // The stream already ended.
      }
    },
  };
}

/** Build a `Response` that carries the given body. */
export function mockResponse(
  body: ReadableStream<Uint8Array>,
  init?: { ok?: boolean; status?: number },
): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    body,
  } as unknown as Response;
}

/** Build a `Response` that carries the given SSE frames and then ends. */
export function sseResponse(frames: string[]): Response {
  const stream = createSseStream();
  for (const frame of frames) stream.push(frame);
  stream.close();
  return mockResponse(stream.body);
}

/**
 * Build a `fetch` mock that serves the given stream. The mock errors the
 * stream when the request aborts, so a test can stop a running stream.
 */
export function mockFetch(stream: SseStream) {
  return vi.fn((_url: string, init?: RequestInit) => {
    init?.signal?.addEventListener("abort", () => stream.abort());
    return Promise.resolve(mockResponse(stream.body));
  });
}

/** Build a `fetch` mock that serves the given SSE frames and then ends. */
export function mockFetchFrames(frames: string[]) {
  const stream = createSseStream();
  for (const frame of frames) stream.push(frame);
  stream.close();
  return mockFetch(stream);
}

/** Build a `data:` frame that carries a `messages` channel event. */
export function dataFrame(event: Record<string, unknown>): string {
  return eventFrame("messages", event);
}

/** Build a `data:` frame that carries an event of any channel. */
export function eventFrame(
  method: string,
  event: Record<string, unknown>,
): string {
  return `data: ${JSON.stringify({
    type: "event",
    seq: 1,
    method,
    params: { namespace: [], timestamp: 0, data: event },
  })}\n\n`;
}
