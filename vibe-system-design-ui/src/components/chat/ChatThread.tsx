import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type AssistantRuntime,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import { ArrowUp } from "lucide-react";
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
 * The scrollable message list plus the composer, all inside a single
 * `AssistantRuntimeProvider`. The `Thread` reads state from the nearest
 * runtime provider ancestor — no props are threaded through for messages.
 */
export function ChatThread({ runtime }: { runtime: AssistantRuntime }) {
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

        <div className="aui-composer">
          <ComposerPrimitive.Root className="aui-composer__root">
            <ComposerPrimitive.Input
              aria-label="Composer"
              placeholder="Reply…"
              className="aui-composer__input"
            />
            <ComposerPrimitive.Send
              aria-label="Send message"
              className="aui-composer__send"
            >
              <ArrowUp className="aui-composer__send-icon" aria-hidden="true" />
            </ComposerPrimitive.Send>
          </ComposerPrimitive.Root>
        </div>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
