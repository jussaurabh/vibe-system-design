import { ChatThread } from "./ChatThread";
import { useChatStream } from "./useChatStream";
import "./chat.css";

/**
 * Right-side chat panel. Occupies exactly 35% of the screen width (the xyflow
 * canvas takes the remaining 65% in App.tsx). Surfaces use the Notion design
 * tokens; the dark theme (`.dark` on <html>) flips them via CSS variables.
 */
export function ChatPanel() {
  const { runtime } = useChatStream();

  return (
    <div
      data-testid="chat-panel"
      className="aui-chat-panel w-[35%] h-screen bg-background border-l border-border text-foreground"
    >
      <ChatThread runtime={runtime} />
    </div>
  );
}
