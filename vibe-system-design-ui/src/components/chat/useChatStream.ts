import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useExternalStoreRuntime,
  generateId,
  type AppendMessage,
  type AssistantRuntime,
  type ThreadMessageLike,
} from "@assistant-ui/react";

import {
  createMessageId,
  eventToAction,
  findFrameEnd,
  needsAssistantMessage,
  parseSseFrame,
  type StreamAction,
} from "../../lib/chat-events";
import { resolveBaseUrl, type StoredMessage } from "../../lib/chat-api";

/**
 * Shape returned by {@link useChatStream}. The hook owns the message list and
 * the run state. It POSTs the new message to `POST /v1/chat/stream` and maps
 * every streamed backend event to an assistant message.
 */
export interface ChatStreamAPI {
  readonly runtime: AssistantRuntime;
  readonly messages: readonly ThreadMessageLike[];
  readonly isRunning: boolean;
  readonly error: Error | null;
  send(text: string): Promise<void>;
  stop(): void;
  loadMessages(messages: StoredMessage[]): void;
  clearMessages(): void;
}

/** A text part of a message. */
interface TextPart {
  readonly type: "text";
  readonly text: string;
}

const STREAM_PATH = "/v1/chat/stream";

/** Read the text parts of a message. */
function textParts(content: ThreadMessageLike["content"]): readonly TextPart[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return content.filter((part): part is TextPart => part.type === "text");
}

/**
 * Chat hook that streams the backend `chat/stream` SSE endpoint.
 *
 * The hook owns the message list. It sends the new message to the backend,
 * reads the response as a `text/event-stream`, and applies the action that
 * {@link eventToAction} returns for every frame. The hook aborts the stream
 * when the user sends a new message or calls `stop`.
 *
 * The database holds the history. The request carries the session id and the
 * one new message, and the backend loads the rest of the conversation.
 */
export function useChatStream(opts?: {
  baseUrl?: string;
  sessionId?: string | null;
}): ChatStreamAPI {
  const [messages, setMessages] = useState<ThreadMessageLike[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // The ref holds the current message list. Every mutation goes through
  // `updateMessages`, so the ref never drifts from the state.
  const messagesRef = useRef<ThreadMessageLike[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const openAssistantIdRef = useRef<string | null>(null);

  // The ref holds the backend URL. The hook keeps a stable identity when the
  // caller passes a new options object on every render.
  const baseUrlRef = useRef(resolveBaseUrl(opts));
  useEffect(() => {
    baseUrlRef.current = resolveBaseUrl(opts);
  }, [opts]);

  // The ref holds the session id, for the same reason.
  const sessionIdRef = useRef<string | null>(opts?.sessionId ?? null);
  useEffect(() => {
    sessionIdRef.current = opts?.sessionId ?? null;
  }, [opts?.sessionId]);

  const updateMessages = useCallback(
    (updater: (prev: ThreadMessageLike[]) => ThreadMessageLike[]) => {
      const next = updater(messagesRef.current);
      messagesRef.current = next;
      setMessages(next);
    },
    [],
  );

  const startAssistant = useCallback(
    (messageId: string) => {
      openAssistantIdRef.current = messageId;
      updateMessages((prev) => {
        // The backend can replay a message id. Reuse the message instead of
        // adding a second one with the same id.
        if (prev.some((message) => message.id === messageId)) {
          return prev.map((message) =>
            message.id === messageId
              ? { ...message, status: { type: "running" } }
              : message,
          );
        }
        return [
          ...prev,
          {
            id: messageId,
            role: "assistant",
            content: [],
            status: { type: "running" },
          },
        ];
      });
    },
    [updateMessages],
  );

  const openTextBlock = useCallback(
    (messageId: string) => {
      updateMessages((prev) =>
        prev.map((message) => {
          if (message.id !== messageId) return message;
          const parts = textParts(message.content);
          const last = parts[parts.length - 1];
          // Skip the block when the previous one is still empty.
          if (last && last.type === "text" && last.text.length === 0) {
            return message;
          }
          return { ...message, content: [...parts, { type: "text", text: "" }] };
        }),
      );
    },
    [updateMessages],
  );

  const appendText = useCallback(
    (messageId: string, text: string) => {
      updateMessages((prev) =>
        prev.map((message) => {
          if (message.id !== messageId) return message;
          const parts = [...textParts(message.content)];
          const last = parts[parts.length - 1];
          if (last && last.type === "text") {
            parts[parts.length - 1] = { ...last, text: last.text + text };
          } else {
            parts.push({ type: "text", text });
          }
          return { ...message, content: parts };
        }),
      );
    },
    [updateMessages],
  );

  const finishAssistant = useCallback(
    (messageId: string) => {
      updateMessages((prev) =>
        prev.map((message) =>
          message.id === messageId
            ? { ...message, status: { type: "complete", reason: "stop" } }
            : message,
        ),
      );
      if (openAssistantIdRef.current === messageId) {
        openAssistantIdRef.current = null;
      }
    },
    [updateMessages],
  );

  const failAssistant = useCallback(
    (messageId: string, reason: "error" | "cancelled") => {
      updateMessages((prev) =>
        prev.map((message) =>
          message.id === messageId
            ? { ...message, status: { type: "incomplete", reason } }
            : message,
        ),
      );
      if (openAssistantIdRef.current === messageId) {
        openAssistantIdRef.current = null;
      }
    },
    [updateMessages],
  );

  const finishOpenAssistant = useCallback(() => {
    const messageId = openAssistantIdRef.current;
    if (!messageId) return;
    finishAssistant(messageId);
  }, [finishAssistant]);

  const failOpenAssistant = useCallback(
    (reason: "error" | "cancelled") => {
      const messageId = openAssistantIdRef.current;
      if (!messageId) return;
      failAssistant(messageId, reason);
    },
    [failAssistant],
  );

  const applyAction = useCallback(
    (action: StreamAction) => {
      switch (action.kind) {
        case "startAssistant":
          startAssistant(action.messageId);
          break;
        case "openTextBlock":
          openTextBlock(action.messageId);
          break;
        case "appendText":
          appendText(action.messageId, action.text);
          break;
        case "closeTextBlock":
          break;
        case "finishAssistant":
          finishAssistant(action.messageId);
          break;
        case "setRunning":
          setIsRunning(action.running);
          break;
        case "setError":
          setError(new Error(action.message));
          setIsRunning(false);
          failOpenAssistant("error");
          break;
        case "done":
          finishOpenAssistant();
          setIsRunning(false);
          break;
        case "ignore":
          break;
      }
    },
    [
      appendText,
      failOpenAssistant,
      finishAssistant,
      finishOpenAssistant,
      openTextBlock,
      startAssistant,
    ],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      // Empty input is not sent.
      if (!trimmed) return;

      const sessionId = sessionIdRef.current;
      // The chat needs a session. The panel opens one before the user types.
      if (!sessionId) {
        setError(new Error("No session is open."));
        return;
      }

      // Abort the previous stream before the new one starts.
      abortRef.current?.abort();
      abortRef.current = null;
      failOpenAssistant("cancelled");

      setError(null);

      updateMessages((prev) => [
        ...prev,
        { id: generateId(), role: "user", content: [{ type: "text", text: trimmed }] },
      ]);

      const controller = new AbortController();
      abortRef.current = controller;
      setIsRunning(true);

      /** Apply one raw SSE frame. The function reports a terminal frame. */
      const handleFrame = (raw: string): boolean => {
        // A superseded stream never touches the state again.
        if (controller.signal.aborted) return false;

        const frame = parseSseFrame(raw);
        // A malformed frame is skipped. The stream continues.
        if (!frame) return false;

        if (frame.type === "done") {
          applyAction({ kind: "done" });
          return true;
        }

        if (frame.type === "error") {
          applyAction({ kind: "setError", message: frame.message });
          return true;
        }

        // Open a message before the mapper runs, so a delta never has no
        // message to attach to.
        if (!openAssistantIdRef.current && needsAssistantMessage(frame.event)) {
          startAssistant(createMessageId());
        }

        applyAction(
          eventToAction(frame.event, openAssistantIdRef.current ?? undefined),
        );
        return false;
      };

      try {
        const response = await fetch(`${baseUrlRef.current}${STREAM_PATH}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, message: trimmed }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(
            `The chat stream failed with status ${response.status}.`,
          );
        }
        if (!response.body) {
          throw new Error("The chat stream returned an empty body.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let terminal = false;

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          // A superseded stream never touches the state again.
          if (controller.signal.aborted) break;
          buffer += decoder.decode(value, { stream: true });
          let end = findFrameEnd(buffer);
          while (end !== -1) {
            const raw = buffer.slice(0, end);
            buffer = buffer.slice(end);
            if (handleFrame(raw)) terminal = true;
            end = findFrameEnd(buffer);
          }
        }

        buffer += decoder.decode();
        if (buffer.trim().length > 0 && handleFrame(buffer)) terminal = true;

        // A connection that drops before the terminal frame is an error.
        if (!terminal && !controller.signal.aborted) {
          throw new Error("The chat stream ended before it finished.");
        }
      } catch (err) {
        // An aborted stream is a user action. It never raises an error.
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setIsRunning(false);
          failOpenAssistant("error");
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setIsRunning(false);
        }
      }
    },
    [
      applyAction,
      failOpenAssistant,
      startAssistant,
      updateMessages,
    ],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    failOpenAssistant("cancelled");
    setIsRunning(false);
  }, [failOpenAssistant]);

  /**
   * Replace the message list with the stored rows of a session. A tool row
   * and a system row stay in the database. They are a log, not something the
   * thread renders.
   */
  const loadMessages = useCallback(
    (rows: StoredMessage[]) => {
      const next: ThreadMessageLike[] = [];
      for (const row of rows) {
        if (row.senderType !== "user" && row.senderType !== "assistant") continue;
        const content = row.content
          .filter(
            (part): part is { readonly type: "text"; readonly text: string } =>
              part.type === "text" && typeof part.text === "string",
          )
          .map((part) => ({ type: "text" as const, text: part.text }));
        next.push({
          id: row.id,
          role: row.senderType,
          content,
          // The status belongs to an assistant message. A user message
          // carries none.
          ...(row.senderType === "assistant"
            ? {
                status:
                  row.status === "incomplete"
                    ? ({ type: "incomplete", reason: "cancelled" } as const)
                    : row.status === "error"
                      ? ({ type: "incomplete", reason: "error" } as const)
                      : ({ type: "complete", reason: "stop" } as const),
              }
            : {}),
        });
      }
      updateMessages(() => next);
    },
    [updateMessages],
  );

  /** Empty the message list. */
  const clearMessages = useCallback(() => {
    updateMessages(() => []);
  }, [updateMessages]);

  const onNew = useCallback(
    async (message: AppendMessage) => {
      const first = message.content[0];
      if (!first || first.type !== "text") {
        throw new Error("Only text messages are supported");
      }
      await send(first.text);
    },
    [send],
  );

  const onCancel = useCallback(async () => {
    stop();
  }, [stop]);

  const runtime = useExternalStoreRuntime({
    messages,
    isRunning,
    convertMessage: (m) => m,
    onNew,
    onCancel,
  });

  return useMemo(
    () => ({
      runtime,
      messages,
      isRunning,
      error,
      send,
      stop,
      loadMessages,
      clearMessages,
    }),
    [runtime, messages, isRunning, error, send, stop, loadMessages, clearMessages],
  );
}
