import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSseStream,
  dataFrame,
  eventFrame,
  mockFetch,
  mockFetchFrames,
  mockResponse,
  type SseStream,
} from "../../../test/sse-mock";
import { useChatStream } from "../useChatStream";

const DONE_FRAME = "event: done\ndata: {}\n\n";

/** Read the text of an assistant message. */
function assistantText(
  messages: readonly { role: string; content: unknown }[],
): string {
  const assistant = messages.filter((message) => message.role === "assistant");
  return assistant
    .flatMap((message) =>
      Array.isArray(message.content)
        ? (message.content as { type: string; text?: string }[])
        : [],
    )
    .map((part) => part.text ?? "")
    .join("");
}

describe("useChatStream", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs messages to /v1/chat/stream and appends streamed assistant text", async () => {
    const fetchMock = mockFetchFrames([
      dataFrame({ event: "message-start", id: "m-1", role: "ai" }),
      dataFrame({
        event: "content-block-delta",
        index: 0,
        delta: { type: "text-delta", text: "hello" },
      }),
      DONE_FRAME,
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("hi");
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/v1/chat/stream"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(assistantText(result.current.messages)).toBe("hello");
    expect(result.current.isRunning).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("sends the conversation history in the request body", async () => {
    const fetchMock = mockFetchFrames([DONE_FRAME]);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("first");
    });
    await act(async () => {
      await result.current.send("second");
    });

    const firstBody = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(firstBody.messages).toEqual([{ role: "user", content: "first" }]);

    const secondBody = JSON.parse(
      (fetchMock.mock.calls[1][1] as RequestInit).body as string,
    );
    expect(secondBody.messages).toEqual([
      { role: "user", content: "first" },
      { role: "user", content: "second" },
    ]);
  });

  it("sets the error and stops on an event: error frame", async () => {
    const fetchMock = mockFetchFrames([
      'event: error\ndata: {"message":"boom"}\n\n',
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("hi");
    });

    expect(result.current.error?.message).toBe("boom");
    expect(result.current.isRunning).toBe(false);
  });

  it("sets the error and stops when the backend returns an HTTP error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(new ReadableStream<Uint8Array>(), { ok: false, status: 500 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("hi");
    });

    expect(result.current.error).not.toBeNull();
    expect(result.current.isRunning).toBe(false);
  });

  it("sets the error when the connection drops before the done frame", async () => {
    const fetchMock = mockFetchFrames([
      dataFrame({ event: "message-start", id: "m-1", role: "ai" }),
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("hi");
    });

    expect(result.current.error).not.toBeNull();
    expect(result.current.isRunning).toBe(false);
  });

  it("aborts the previous stream when send runs again", async () => {
    const stream = createSseStream();
    const fetchMock = mockFetch(stream);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChatStream());

    act(() => {
      void result.current.send("first");
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const firstSignal = (fetchMock.mock.calls[0][1] as RequestInit)
      .signal as AbortSignal;
    expect(firstSignal.aborted).toBe(false);

    act(() => {
      void result.current.send("second");
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(firstSignal.aborted).toBe(true);
    stream.close();
  });

  it("stops the stream when stop runs", async () => {
    const stream = createSseStream();
    const fetchMock = mockFetch(stream);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChatStream());

    act(() => {
      void result.current.send("hi");
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const signal = (fetchMock.mock.calls[0][1] as RequestInit)
      .signal as AbortSignal;

    act(() => {
      result.current.stop();
    });

    expect(signal.aborted).toBe(true);
    expect(result.current.isRunning).toBe(false);
  });

  it("ignores the frames of a superseded stream", async () => {
    const streams: SseStream[] = [];
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => {
      const stream = createSseStream();
      streams.push(stream);
      return Promise.resolve(mockResponse(stream.body));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChatStream());

    act(() => {
      void result.current.send("first");
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    act(() => {
      void result.current.send("second");
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // The first stream delivers a frame after the second send superseded it.
    streams[0].push(dataFrame({ event: "message-start", id: "m-1", role: "ai" }));
    streams[0].push(
      dataFrame({
        event: "content-block-delta",
        index: 0,
        delta: { type: "text-delta", text: "stale" },
      }),
    );

    await waitFor(() => expect(result.current.isRunning).toBe(true));
    expect(assistantText(result.current.messages)).toBe("");
    streams[0].close();
    streams[1].close();
  });

  it("does not send on empty input", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("   ");
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.messages).toHaveLength(0);
  });

  it("skips a malformed frame and keeps reading the stream", async () => {
    const fetchMock = mockFetchFrames([
      "data: {not json}\n\n",
      dataFrame({ event: "message-start", id: "m-1", role: "ai" }),
      dataFrame({
        event: "content-block-delta",
        index: 0,
        delta: { type: "text-delta", text: "ok" },
      }),
      DONE_FRAME,
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("hi");
    });

    expect(assistantText(result.current.messages)).toBe("ok");
    expect(result.current.error).toBeNull();
  });

  it("ignores an unknown backend event", async () => {
    const fetchMock = mockFetchFrames([
      eventFrame("brand-new-channel", { event: "whatever" }),
      dataFrame({ event: "message-start", id: "m-1", role: "ai" }),
      dataFrame({
        event: "content-block-delta",
        index: 0,
        delta: { type: "text-delta", text: "ok" },
      }),
      DONE_FRAME,
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("hi");
    });

    expect(assistantText(result.current.messages)).toBe("ok");
    expect(result.current.error).toBeNull();
  });

  it("marks a partial assistant message as incomplete when the stream fails", async () => {
    const fetchMock = mockFetchFrames([
      dataFrame({ event: "message-start", id: "m-1", role: "ai" }),
      dataFrame({
        event: "content-block-delta",
        index: 0,
        delta: { type: "text-delta", text: "partial" },
      }),
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("hi");
    });

    const assistant = result.current.messages.find(
      (message) => message.role === "assistant",
    );
    expect(assistant?.status).toEqual({ type: "incomplete", reason: "error" });
  });

  it("reads the running state from the lifecycle channel", async () => {
    const fetchMock = mockFetchFrames([
      eventFrame("lifecycle", { event: "running" }),
      DONE_FRAME,
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.send("hi");
    });

    expect(result.current.isRunning).toBe(false);
  });
});

describe("useChatStream stream helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the stream open until the test closes it", async () => {
    const stream: SseStream = createSseStream();
    const fetchMock = mockFetch(stream);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChatStream());

    act(() => {
      void result.current.send("hi");
    });
    await waitFor(() => expect(result.current.isRunning).toBe(true));

    stream.close();
    await waitFor(() => expect(result.current.isRunning).toBe(false));
  });
});
