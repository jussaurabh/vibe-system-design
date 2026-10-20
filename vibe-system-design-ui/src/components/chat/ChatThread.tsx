import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
  type AssistantRuntime,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import { ArrowUp, Square } from "lucide-react";
import "./chat.css";

// Render every text part as Markdown. `smooth={false}` keeps the reveal
// deterministic (important for tests) — Part 2 can re-enable streaming polish.
function MarkdownText() {
  return <MarkdownTextPrimitive smooth={false} />;
}

function UserMessage() {
  return (
    <MessagePrimitive.Root
      data-testid="user-message"
      className="aui-message aui-message--user bg-primary text-primary-foreground"
    >
      <MessagePrimitive.Parts components={{ Text: MarkdownText }} />
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root
      data-testid="assistant-message"
      className="aui-message aui-message--assistant bg-card text-card-foreground border border-border"
    >
      <MessagePrimitive.Parts components={{ Text: MarkdownText }} />
    </MessagePrimitive.Root>
  );
}

/**
 * Button that ends the running stream. The button calls the runtime, so the
 * runtime cancels the run and the hook aborts the request.
 */
function StopButton() {
  const aui = useAui();
  const isRunning = useAuiState((s) => s.thread.isRunning);
  if (!isRunning) return null;

  return (
    <button
      type="button"
      aria-label="Stop generating"
      className="aui-composer__stop inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-card text-foreground"
      onClick={() => aui.thread.cancelRun()}
    >
      <Square className="aui-composer__stop-icon" aria-hidden="true" />
    </button>
  );
}

/** Indicator that the assistant is still writing. */
function RunningIndicator() {
  const isRunning = useAuiState((s) => s.thread.isRunning);
  if (!isRunning) return null;

  return (
    <div
      data-testid="chat-running"
      role="status"
      className="aui-chat-running px-4 pt-2 text-sm text-muted-foreground"
    >
      Generating…
    </div>
  );
}

/**
 * The composer. The input is disabled while a run is in flight, so the user
 * cannot queue a second message into a running stream.
 */
function Composer({ disabled }: { disabled: boolean }) {
  const isRunning = useAuiState((s) => s.thread.isRunning);

  return (
    <div className="aui-composer">
      <ComposerPrimitive.Root className="aui-composer__root">
        <ComposerPrimitive.Input
          aria-label="Composer"
          placeholder="Reply…"
          className="aui-composer__input"
          disabled={isRunning || disabled}
        />
        <ComposerPrimitive.Send
          aria-label="Send message"
          className="aui-composer__send"
        >
          <ArrowUp className="aui-composer__send-icon" aria-hidden="true" />
        </ComposerPrimitive.Send>
        <StopButton />
      </ComposerPrimitive.Root>
      <RunningIndicator />
    </div>
  );
}

/**
 * The scrollable message list plus the composer, all inside a single
 * `AssistantRuntimeProvider`. The `Thread` reads state from the nearest
 * runtime provider ancestor — no props are threaded through for messages.
 */
export function ChatThread({
  runtime,
  disabled = false,
}: {
  runtime: AssistantRuntime;
  disabled?: boolean;
}) {
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="aui-thread">
        <ThreadPrimitive.Viewport className="aui-thread__viewport">
          <div data-testid="chat-message-list" className="aui-thread__list">
            <ThreadPrimitive.Empty>
              <div className="aui-thread__empty">
                Ask anything about your system design to get started.
              </div>
            </ThreadPrimitive.Empty>
            <ThreadPrimitive.Messages
              components={{ UserMessage, AssistantMessage }}
            />
          </div>
        </ThreadPrimitive.Viewport>

        <Composer disabled={disabled} />
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
