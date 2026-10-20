import { ChatThread } from "./ChatThread";
import { useChatStream } from "./useChatStream";
import "./chat.css";

/**
 * Right-side chat panel. Occupies exactly 35% of the screen width (the xyflow
 * canvas takes the remaining 65% in App.tsx). Surfaces use the Notion design
 * tokens; the dark theme (`.dark` on <html>) flips them via CSS variables.
 */
export function ChatPanel() {
  const { runtime, error } = useChatStream();

  return (
    <div
      data-testid="chat-panel"
      className="aui-chat-panel w-[35%] h-screen bg-background border-l border-border text-foreground"
    >
      {error ? (
        <div
          data-testid="chat-error"
          role="alert"
          className="aui-chat-error mx-4 mt-3 rounded-md border border-destructive bg-background px-3 py-2 text-sm text-destructive"
        >
          {error.message}
        </div>
      ) : null}
      <ChatThread runtime={runtime} />
    </div>
  );
}
