import { useCallback, useMemo, useRef, useState } from "react";
import {
  useExternalStoreRuntime,
  generateId,
  type AppendMessage,
  type AssistantRuntime,
  type ThreadMessageLike,
} from "@assistant-ui/react";

/**
 * Shape returned by {@link useChatStream}. Part 1 uses a local echo only — no
 * network, no SSE, no backend `chat/stream`. `send` appends the user message,
 * marks the thread running, then appends a local assistant echo after a short
 * delay. Part 2 replaces the echo with the real streaming backend.
 */
export interface ChatStreamAPI {
  readonly runtime: AssistantRuntime;
  readonly messages: readonly ThreadMessageLike[];
  readonly isRunning: boolean;
  readonly error: Error | null;
  send(text: string): Promise<void>;
  stop(): void;
}

const ECHO_DELAY_MS = 600;

export function useChatStream(opts?: { baseUrl?: string }): ChatStreamAPI {
  // `baseUrl` is reserved for Part 2 backend integration; unused in Part 1.
  void opts;

  const [messages, setMessages] = useState<ThreadMessageLike[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      // Empty input is not sent.
      if (!trimmed) return;

      setError(null);
      setMessages((prev) => [
        ...prev,
        {
          id: generateId(),
          role: "user",
          content: [{ type: "text", text: trimmed }],
        },
      ]);
      setIsRunning(true);

      // Local echo: no network. Replace with SSE streaming in Part 2.
      clearTimer();
      timerRef.current = setTimeout(() => {
        setMessages((prev) => [
          ...prev,
          {
            id: generateId(),
            role: "assistant",
            content: [{ type: "text", text: `Echo: ${trimmed}` }],
          },
        ]);
        setIsRunning(false);
        timerRef.current = null;
      }, ECHO_DELAY_MS);
    },
    [clearTimer],
  );

  const stop = useCallback(() => {
    clearTimer();
    setIsRunning(false);
  }, [clearTimer]);

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
    () => ({ runtime, messages, isRunning, error, send, stop }),
    [runtime, messages, isRunning, error, send, stop],
  );
}
