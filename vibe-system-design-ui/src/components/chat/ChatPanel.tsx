import { useEffect, useRef, useState } from "react";
import { PanelLeft } from "lucide-react";

import { ChatThread } from "./ChatThread";
import { SessionDrawer } from "./SessionDrawer";
import { useChatStream, type ChatStreamAPI } from "./useChatStream";
import { useSessions } from "./useSessions";
import "./chat.css";

/**
 * Right-side chat panel. Occupies exactly 35% of the screen width (the xyflow
 * canvas takes the remaining 65% in App.tsx). Surfaces use the Notion design
 * tokens; the dark theme (`.dark` on <html>) flips them via CSS variables.
 */
export function ChatPanel() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  // The session hook hands the stored messages to the chat hook. The chat
  // hook needs the session id, so the two hooks read each other through a
  // ref instead of through the render order.
  const chatRef = useRef<ChatStreamAPI | null>(null);
  const sessions = useSessions({
    onMessages: (messages) => chatRef.current?.loadMessages(messages),
  });
  const chat = useChatStream({ sessionId: sessions.activeSessionId });
  // The ref is written during the render on purpose. The session hook loads
  // the messages of the session in its mount effect, and that effect runs
  // before any effect of this component. The chat hook must already be in
  // the ref when the first session opens.
  // eslint-disable-next-line react/refs
  chatRef.current = chat;

  const activeSession = sessions.sessions.find(
    (session) => session.id === sessions.activeSessionId,
  );
  const title =
    activeSession !== undefined && activeSession.title.length > 0
      ? activeSession.title
      : "Untitled session";

  // The backend renames a session after its first message and moves its last
  // message time. The list is read again when a run ends, so the header and
  // the drawer show the new title.
  const wasRunningRef = useRef(false);
  useEffect(() => {
    const wasRunning = wasRunningRef.current;
    wasRunningRef.current = chat.isRunning;
    if (!wasRunning || chat.isRunning) return;
    if (sessions.activeSessionId === null) return;
    void sessions.refreshSession(sessions.activeSessionId);
  }, [chat.isRunning, sessions]);

  return (
    <div
      data-testid="chat-panel"
      className="aui-chat-panel w-[35%] h-screen bg-background border-l border-border text-foreground"
    >
      <div className="aui-chat-header">
        <button
          type="button"
          data-testid="chat-menu"
          aria-label="Open sessions"
          className="aui-chat-header__menu"
          onClick={() => setDrawerOpen((open) => !open)}
        >
          <PanelLeft className="aui-chat-header__menu-icon" aria-hidden="true" />
        </button>
        <span data-testid="chat-session-title" className="aui-chat-header__title">
          {title}
        </span>
      </div>

      {chat.error !== null || sessions.error !== null ? (
        <div
          data-testid="chat-error"
          role="alert"
          className="aui-chat-error mx-4 mt-3 rounded-md border border-destructive bg-background px-3 py-2 text-sm text-destructive"
        >
          {(chat.error ?? sessions.error)?.message}
        </div>
      ) : null}

      <ChatThread
        runtime={chat.runtime}
        disabled={sessions.activeSessionId === null}
      />

      <SessionDrawer
        open={drawerOpen}
        sessions={sessions.sessions}
        activeSessionId={sessions.activeSessionId}
        onSelect={(id) => void sessions.selectSession(id)}
        onCreate={() => void sessions.createSession()}
        onDelete={(id) => void sessions.removeSession(id)}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}
