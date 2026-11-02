import React from "react";
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
import { ArrowUp, Copy, Pencil, Square, ThumbsDown, ThumbsUp } from "lucide-react";
import remarkGfm from "remark-gfm";
import { stripUserPromptTags } from "../../lib/chat-text";
import { useToast } from "../../lib/toast";
import "./chat.css";

// GitHub tables and other GFM constructs need this plugin.
const REMARK_PLUGINS = [remarkGfm];

// Render every text part as Markdown. `smooth={false}` keeps the reveal
// deterministic (important for tests) — Part 2 can re-enable streaming polish.
function MarkdownText() {
  return (
    <MarkdownTextPrimitive smooth={false} remarkPlugins={REMARK_PLUGINS} />
  );
}

function UserMessage() {
  const [showActions, setShowActions] = React.useState(false);

  return (
    <div
      className="aui-message__wrapper--user"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <MessagePrimitive.Root
        data-testid="user-message"
        className="aui-message aui-message--user bg-primary text-primary-foreground"
      >
        <MessagePrimitive.Parts components={{ Text: MarkdownText }} />
      </MessagePrimitive.Root>
      <div
        className="aui-message-actions aui-message__actions--user"
        data-testid="user-actions"
        style={{ visibility: showActions ? "visible" : "hidden", marginTop: '-1.05rem' }}
      >
        <CopyMessageButton label="Copy message" transform={stripUserPromptTags} />
        <button type="button" aria-label="Edit message" className="aui-message-action">
          <Pencil className="aui-message-action__icon" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div
      data-testid="chat-typing"
      role="status"
      aria-label="Assistant is typing"
      className="aui-typing"
    >
      <span className="aui-typing__dot" />
      <span className="aui-typing__dot" />
      <span className="aui-typing__dot" />
    </div>
  );
}

function PendingAssistant() {
  const waiting = useAuiState((s) => {
    if (!s.thread.isRunning) return false;
    return s.thread.messages.at(-1)?.role === "user";
  });
  if (!waiting) return null;
  return <TypingIndicator />;
}

function AssistantText() {
  const streaming = useAuiState((s) => s.part.status.type === "running");
  return (
    <div
      data-testid="assistant-text"
      data-streaming={streaming ? "true" : undefined}
      className="aui-message__text"
    >
      <MarkdownText />
    </div>
  );
}

function AssistantMessage() {
  const typing = useAuiState((s) => {
    if (s.message.status?.type !== "running") return false;
    return !s.message.parts.some(
      (part) => part.type === "text" && part.text.length > 0,
    );
  });

  const complete = useAuiState((s) => s.message.status?.type === "complete");

  return (
    <MessagePrimitive.Root
      data-testid="assistant-message"
      className="aui-message aui-message--assistant"
    >
      {typing ? (
        <TypingIndicator />
      ) : (
        <MessagePrimitive.Parts components={{ Text: AssistantText }} />
      )}
      {complete ? <AssistantActions /> : null}
    </MessagePrimitive.Root>
  );
}

function CopyMessageButton({
  label,
  transform,
}: {
  label: string;
  transform?: (text: string) => string;
}) {
  const aui = useAui();
  const { showToast } = useToast();

  return (
    <button
      type="button"
      aria-label={label}
      className="aui-message-action"
      onClick={() => {
        const text = aui.message.getCopyText();
        const value = transform ? transform(text) : text;
        void navigator.clipboard?.writeText(value)?.catch(() => {});
        showToast("Copied", 3000);
      }}
    >
      <Copy className="aui-message-action__icon" aria-hidden="true" />
    </button>
  );
}

function AssistantActions() {
  return (
    <div data-testid="assistant-actions" className="aui-message-actions">
      <CopyMessageButton label="Copy response" />
      <button type="button" aria-label="Good response" className="aui-message-action">
        <ThumbsUp className="aui-message-action__icon" aria-hidden="true" />
      </button>
      <button type="button" aria-label="Bad response" className="aui-message-action">
        <ThumbsDown className="aui-message-action__icon" aria-hidden="true" />
      </button>
    </div>
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
            <PendingAssistant />
          </div>
        </ThreadPrimitive.Viewport>

        <Composer disabled={disabled} />
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
