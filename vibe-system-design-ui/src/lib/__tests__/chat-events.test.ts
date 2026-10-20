import { describe, expect, it } from "vitest";

import {
  createMessageId,
  eventToAction,
  findFrameEnd,
  needsAssistantMessage,
  parseSseFrame,
  readEventName,
  type ProtocolEvent,
} from "../chat-events";

/** Build a `ProtocolEvent` for the `messages` channel. */
function messageEvent(
  event: string,
  extra: Record<string, unknown> = {},
): ProtocolEvent {
  return {
    type: "event",
    seq: 1,
    method: "messages",
    params: {
      namespace: [],
      timestamp: 0,
      data: { event, ...extra },
    },
  };
}

/** Build a `ProtocolEvent` for the `lifecycle` channel. */
function lifecycleEvent(
  event: string,
  extra: Record<string, unknown> = {},
): ProtocolEvent {
  return {
    type: "event",
    seq: 1,
    method: "lifecycle",
    params: {
      namespace: [],
      timestamp: 0,
      data: { event, ...extra },
    },
  };
}

describe("parseSseFrame", () => {
  it("parses a data: ProtocolEvent frame", () => {
    const out = parseSseFrame(
      'data: {"type":"event","seq":1,"method":"messages","params":{"data":{"event":"content-block-delta","delta":"hi"}}}\n\n',
    );
    expect(out?.type).toBe("data");
    expect(out?.type === "data" && out.event.method).toBe("messages");
  });

  it("parses event: done", () => {
    expect(parseSseFrame("event: done\ndata: {}\n\n")?.type).toBe("done");
  });

  it("parses event: error with message", () => {
    const out = parseSseFrame('event: error\ndata: {"message":"boom"}\n\n');
    expect(out?.type).toBe("error");
    expect(out?.type === "error" && out.message).toBe("boom");
  });

  it("returns null for blank lines", () => {
    expect(parseSseFrame("\n\n")).toBeNull();
  });

  it("returns null for a malformed data payload", () => {
    expect(parseSseFrame("data: {not json}\n\n")).toBeNull();
  });

  it("returns null for a payload that is not an event envelope", () => {
    expect(parseSseFrame('data: {"hello":"world"}\n\n')).toBeNull();
  });

  it("falls back to a default message for an error frame without a message", () => {
    const out = parseSseFrame("event: error\ndata: {}\n\n");
    expect(out?.type === "error" && out.message.length > 0).toBe(true);
  });
});

describe("eventToAction", () => {
  it("maps content-block-delta to appendText", () => {
    const ev = messageEvent("content-block-delta", { delta: "hello" });
    expect(eventToAction(ev, "m-1")).toEqual({
      kind: "appendText",
      messageId: "m-1",
      text: "hello",
    });
  });

  it("maps a text-delta payload to appendText", () => {
    const ev = messageEvent("content-block-delta", {
      delta: { type: "text-delta", text: "hello" },
    });
    expect(eventToAction(ev, "m-1")).toEqual({
      kind: "appendText",
      messageId: "m-1",
      text: "hello",
    });
  });

  it("maps message-start to startAssistant", () => {
    const ev = messageEvent("message-start");
    expect(eventToAction(ev, undefined).kind).toBe("startAssistant");
  });

  it("keeps the backend message id on message-start", () => {
    const ev = messageEvent("message-start", { id: "backend-1" });
    expect(eventToAction(ev, undefined)).toEqual({
      kind: "startAssistant",
      messageId: "backend-1",
    });
  });

  it("ignores message-start while an assistant message is open", () => {
    const ev = messageEvent("message-start");
    expect(eventToAction(ev, "m-1")).toEqual({ kind: "ignore" });
  });

  it("maps content-block-start to openTextBlock", () => {
    const ev = messageEvent("content-block-start");
    expect(eventToAction(ev, "m-1")).toEqual({
      kind: "openTextBlock",
      messageId: "m-1",
    });
  });

  it("maps content-block-finish to closeTextBlock", () => {
    const ev = messageEvent("content-block-finish");
    expect(eventToAction(ev, "m-1")).toEqual({
      kind: "closeTextBlock",
      messageId: "m-1",
    });
  });

  it("maps message-finish to finishAssistant", () => {
    const ev = messageEvent("message-finish");
    expect(eventToAction(ev, "m-1")).toEqual({
      kind: "finishAssistant",
      messageId: "m-1",
    });
  });

  it("ignores a delta when no assistant message is open", () => {
    const ev = messageEvent("content-block-delta", { delta: "hello" });
    expect(eventToAction(ev, undefined)).toEqual({ kind: "ignore" });
  });

  it("ignores a reasoning delta", () => {
    const ev = messageEvent("content-block-delta", {
      delta: { type: "reasoning-delta", reasoning: "hmm" },
    });
    expect(eventToAction(ev, "m-1")).toEqual({ kind: "ignore" });
  });

  it("maps the lifecycle running event to setRunning", () => {
    expect(eventToAction(lifecycleEvent("running"), undefined)).toEqual({
      kind: "setRunning",
      running: true,
    });
  });

  it("maps the lifecycle completed event to setRunning false", () => {
    expect(eventToAction(lifecycleEvent("completed"), undefined)).toEqual({
      kind: "setRunning",
      running: false,
    });
  });

  it("maps the lifecycle error event to setError", () => {
    expect(
      eventToAction(lifecycleEvent("error", { error: "kaboom" }), undefined),
    ).toEqual({ kind: "setError", message: "kaboom" });
  });

  it("maps a messages error event to setError", () => {
    expect(
      eventToAction(messageEvent("error", { message: "bad" }), undefined),
    ).toEqual({ kind: "setError", message: "bad" });
  });

  it("ignores metadata events", () => {
    expect(eventToAction(messageEvent("usage"), undefined)).toEqual({
      kind: "ignore",
    });
    expect(eventToAction(messageEvent("provider"), undefined)).toEqual({
      kind: "ignore",
    });
  });

  it("ignores the updates channel", () => {
    const ev: ProtocolEvent = {
      type: "event",
      seq: 2,
      method: "updates",
      params: { namespace: [], timestamp: 0, data: { node: "agent" } },
    };
    expect(eventToAction(ev, undefined)).toEqual({ kind: "ignore" });
  });

  it("ignores the tasks channel", () => {
    const ev: ProtocolEvent = {
      type: "event",
      seq: 3,
      method: "tasks",
      params: { namespace: [], timestamp: 0, data: { input: {} } },
    };
    expect(eventToAction(ev, undefined)).toEqual({ kind: "ignore" });
  });

  it("maps an unknown event to ignore and never throws", () => {
    const ev = messageEvent("something-new");
    expect(eventToAction(ev, undefined)).toEqual({ kind: "ignore" });
  });

  it("maps an unknown channel to ignore and never throws", () => {
    const ev: ProtocolEvent = {
      type: "event",
      seq: 4,
      method: "brand-new-channel",
      params: { namespace: [], timestamp: 0, data: { event: "x" } },
    };
    expect(eventToAction(ev, "m-1")).toEqual({ kind: "ignore" });
  });
});

describe("readEventName", () => {
  it("reads the event name from the payload", () => {
    expect(readEventName(messageEvent("message-start"))).toBe("message-start");
  });

  it("returns undefined when the payload has no name", () => {
    const ev: ProtocolEvent = {
      type: "event",
      seq: 5,
      method: "updates",
      params: { namespace: [], timestamp: 0, data: { node: "agent" } },
    };
    expect(readEventName(ev)).toBeUndefined();
  });
});

describe("needsAssistantMessage", () => {
  it("reports the content events that need an open message", () => {
    expect(needsAssistantMessage(messageEvent("content-block-delta"))).toBe(
      true,
    );
    expect(needsAssistantMessage(messageEvent("content-block-start"))).toBe(
      true,
    );
  });

  it("does not report the metadata events", () => {
    expect(needsAssistantMessage(messageEvent("message-start"))).toBe(false);
    expect(needsAssistantMessage(messageEvent("usage"))).toBe(false);
  });
});

describe("createMessageId", () => {
  it("returns a unique id on every call", () => {
    expect(createMessageId()).not.toBe(createMessageId());
  });
});

describe("findFrameEnd", () => {
  it("finds the end of a frame that uses LF line endings", () => {
    expect(findFrameEnd("data: {}\n\n")).toBe(10);
  });

  it("finds the end of a frame that uses CRLF line endings", () => {
    expect(findFrameEnd("data: {}\r\n\r\n")).toBe(12);
  });

  it("returns -1 when the buffer holds no complete frame", () => {
    expect(findFrameEnd("data: {}")).toBe(-1);
  });
});
