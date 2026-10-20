/**
 * Pure translation from the backend `chat/stream` SSE frames to assistant-ui
 * message actions.
 *
 * The backend sends one `ProtocolEvent` per frame. Each event carries a
 * `method` (the stream channel) and a `params.data` payload. This module maps
 * that payload to a `StreamAction`. The hook in
 * `src/components/chat/useChatStream.ts` applies the action to its state.
 *
 * The module has no React and no network dependency. Every event that the
 * mapper does not know maps to `ignore`, so a new backend event never breaks
 * the UI.
 */

/** Envelope that the backend sends for every streamed event. */
export interface ProtocolEvent {
  readonly type: "event";
  readonly seq: number;
  readonly method: string;
  readonly params: {
    readonly namespace: readonly string[];
    readonly timestamp: number;
    readonly node?: string;
    readonly data: unknown;
  };
}

/** One decoded SSE frame. */
export type SseFrame =
  | { readonly type: "data"; readonly event: ProtocolEvent }
  | { readonly type: "done" }
  | { readonly type: "error"; readonly message: string };

/** One state change for the chat hook. */
export type StreamAction =
  | { readonly kind: "startAssistant"; readonly messageId: string }
  | { readonly kind: "openTextBlock"; readonly messageId: string }
  | { readonly kind: "appendText"; readonly messageId: string; readonly text: string }
  | { readonly kind: "closeTextBlock"; readonly messageId: string }
  | { readonly kind: "finishAssistant"; readonly messageId: string }
  | { readonly kind: "setRunning"; readonly running: boolean }
  | { readonly kind: "setError"; readonly message: string }
  | { readonly kind: "done" }
  | { readonly kind: "ignore" };

/** Event names of the `messages` channel that carry message content. */
const MESSAGE_CONTENT_EVENTS = new Set([
  "content-block-start",
  "content-block-delta",
]);

/** Default text for an error frame that carries no message. */
const DEFAULT_ERROR_MESSAGE = "The chat stream failed.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalize a parsed JSON payload into a {@link ProtocolEvent}. The function
 * returns `null` when the payload is not an event envelope.
 */
function toProtocolEvent(value: unknown): ProtocolEvent | null {
  if (!isRecord(value)) return null;
  const { method, params } = value;
  if (typeof method !== "string" || !isRecord(params)) return null;

  const namespace = Array.isArray(params.namespace)
    ? params.namespace.map((segment) => String(segment))
    : [];

  return {
    type: "event",
    seq: typeof value.seq === "number" ? value.seq : 0,
    method,
    params: {
      namespace,
      timestamp: typeof params.timestamp === "number" ? params.timestamp : 0,
      ...(typeof params.node === "string" ? { node: params.node } : {}),
      data: params.data,
    },
  };
}

/**
 * Read the event name from a `ProtocolEvent` payload. The name lives in
 * `params.data.event` for the `messages` and `lifecycle` channels.
 */
export function readEventName(event: ProtocolEvent): string | undefined {
  const data = event.params.data;
  if (!isRecord(data)) return undefined;
  const name = data.event;
  return typeof name === "string" ? name : undefined;
}

/** Read the message id that the backend assigned to a `message-start` event. */
function readMessageId(data: Record<string, unknown> | undefined): string | undefined {
  const id = data?.id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

/**
 * Read the text that a `content-block-delta` event carries. The protocol sends
 * a `text-delta` object. A plain string is accepted as well, because the
 * plan-level contract describes the delta that way.
 */
function readDeltaText(delta: unknown): string | null {
  if (typeof delta === "string") return delta;
  if (!isRecord(delta)) return null;

  if (delta.type === "text-delta" && typeof delta.text === "string") {
    return delta.text;
  }

  if (delta.type === "block-delta" && isRecord(delta.fields)) {
    const { fields } = delta;
    if (fields.type === "text" && typeof fields.text === "string") {
      return fields.text;
    }
  }

  return null;
}

/** Read the human readable message of an error event. */
function readErrorMessage(data: Record<string, unknown> | undefined): string {
  const message = data?.message;
  if (typeof message === "string" && message.length > 0) return message;
  const error = data?.error;
  if (typeof error === "string" && error.length > 0) return error;
  return DEFAULT_ERROR_MESSAGE;
}

/** Create a unique id for an assistant message. */
export function createMessageId(): string {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef && typeof cryptoRef.randomUUID === "function") {
    return cryptoRef.randomUUID();
  }
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Find the end of the first SSE frame in the buffer. The function returns -1
 * when the buffer holds no complete frame. The function accepts the CRLF line
 * ending, because a proxy can rewrite it.
 */
export function findFrameEnd(buffer: string): number {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (crlf !== -1 && (lf === -1 || crlf < lf)) return crlf + 4;
  if (lf !== -1) return lf + 2;
  return -1;
}

/**
 * Decode one raw SSE frame. The function returns `null` for a blank frame and
 * for a malformed payload, so the caller can skip the frame and keep reading.
 */
export function parseSseFrame(raw: string): SseFrame | null {
  let eventName: string | undefined;
  const dataLines: string[] = [];

  for (const line of raw.split("\n")) {
    const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (trimmed.length === 0 || trimmed.startsWith(":")) continue;

    const colon = trimmed.indexOf(":");
    const field = colon === -1 ? trimmed : trimmed.slice(0, colon);
    let value = colon === -1 ? "" : trimmed.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "event") eventName = value;
    else if (field === "data") dataLines.push(value);
  }

  if (eventName === "done") return { type: "done" };
  if (eventName === "error") {
    return { type: "error", message: readErrorPayload(dataLines.join("\n")) };
  }

  if (dataLines.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(dataLines.join("\n"));
  } catch {
    return null;
  }

  const event = toProtocolEvent(parsed);
  if (!event) return null;
  return { type: "data", event };
}

/** Read the message of an `event: error` frame. */
function readErrorPayload(payload: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return payload.length > 0 ? payload : DEFAULT_ERROR_MESSAGE;
  }
  if (!isRecord(parsed)) return DEFAULT_ERROR_MESSAGE;
  return readErrorMessage(parsed);
}

/**
 * Map one `messages` channel event to an action.
 *
 * The `openAssistantId` argument holds the id of the assistant message that is
 * currently open. The function returns `ignore` when no assistant message is
 * open, because the event has no message to attach to.
 */
function messagesAction(
  name: string | undefined,
  data: Record<string, unknown> | undefined,
  openAssistantId: string | undefined,
): StreamAction {
  switch (name) {
    case "message-start": {
      if (openAssistantId !== undefined) return { kind: "ignore" };
      return {
        kind: "startAssistant",
        messageId: readMessageId(data) ?? createMessageId(),
      };
    }
    case "content-block-start": {
      if (openAssistantId === undefined) return { kind: "ignore" };
      return { kind: "openTextBlock", messageId: openAssistantId };
    }
    case "content-block-delta": {
      const text = readDeltaText(data?.delta);
      if (text === null || text.length === 0) return { kind: "ignore" };
      if (openAssistantId === undefined) return { kind: "ignore" };
      return { kind: "appendText", messageId: openAssistantId, text };
    }
    case "content-block-finish": {
      if (openAssistantId === undefined) return { kind: "ignore" };
      return { kind: "closeTextBlock", messageId: openAssistantId };
    }
    case "message-finish": {
      if (openAssistantId === undefined) return { kind: "ignore" };
      return { kind: "finishAssistant", messageId: openAssistantId };
    }
    case "error":
      return { kind: "setError", message: readErrorMessage(data) };
    default:
      return { kind: "ignore" };
  }
}

/**
 * Map one `lifecycle` channel event to an action. The lifecycle channel
 * reports the run state of the agent.
 */
function lifecycleAction(
  name: string | undefined,
  data: Record<string, unknown> | undefined,
): StreamAction {
  switch (name) {
    case "started":
    case "running":
      return { kind: "setRunning", running: true };
    case "completed":
    case "interrupted":
      return { kind: "setRunning", running: false };
    case "error":
    case "failed":
      return { kind: "setError", message: readErrorMessage(data) };
    default:
      return { kind: "ignore" };
  }
}

/**
 * Map one `ProtocolEvent` to an action. The function never throws. An event
 * that the mapper does not know maps to `ignore`.
 */
export function eventToAction(
  event: ProtocolEvent,
  openAssistantId: string | undefined,
): StreamAction {
  const data = isRecord(event.params.data) ? event.params.data : undefined;
  const name = readEventName(event);

  switch (event.method) {
    case "messages":
      return messagesAction(name, data, openAssistantId);
    case "lifecycle":
      return lifecycleAction(name, data);
    default:
      return { kind: "ignore" };
  }
}

/**
 * Report whether an event carries message content that needs an open
 * assistant message. The hook uses the function to open a message before the
 * mapper runs.
 */
export function needsAssistantMessage(event: ProtocolEvent): boolean {
  if (event.method !== "messages") return false;
  const name = readEventName(event);
  return name !== undefined && MESSAGE_CONTENT_EVENTS.has(name);
}
