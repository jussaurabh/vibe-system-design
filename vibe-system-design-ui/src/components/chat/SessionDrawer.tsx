import { useEffect, useState, type ReactElement } from "react";
import { Plus, Trash2, X } from "lucide-react";

import type { SessionSummary } from "../../lib/chat-api";
import { formatRelativeTime } from "../../lib/relative-time";

export interface SessionDrawerProps {
  readonly open: boolean;
  readonly sessions: readonly SessionSummary[];
  readonly activeSessionId: string | null;
  readonly onSelect: (sessionId: string) => void;
  readonly onCreate: () => void;
  readonly onDelete: (sessionId: string) => void;
  readonly onClose: () => void;
}

/** The label of a session without a title. */
const UNTITLED = "Untitled session";

/**
 * The session drawer slides over the chat panel from the left. It holds the
 * list of the conversations of the user, a button that creates a new one, and
 * a delete control on every row.
 */
export function SessionDrawer(props: SessionDrawerProps): ReactElement | null {
  const { open, onClose } = props;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return <SessionList {...props} />;
}

/**
 * The body of the drawer. The component mounts every time the drawer opens,
 * so the clock of the relative labels is read once, when it mounts.
 */
function SessionList(props: SessionDrawerProps): ReactElement {
  const { sessions, activeSessionId, onSelect, onCreate, onDelete, onClose } =
    props;
  const now = useState(() => Date.now())[0];

  return (
    <>
      <div
        data-testid="session-drawer-backdrop"
        aria-hidden="true"
        className="aui-session-backdrop"
        onClick={onClose}
      />
      <div
        data-testid="session-drawer"
        role="dialog"
        aria-label="Chat sessions"
        className="aui-session-drawer"
      >
        <div className="aui-session-drawer__header">
          <button
            type="button"
            data-testid="session-new"
            aria-label="New session"
            className="aui-session-drawer__new"
            onClick={onCreate}
          >
            <Plus className="aui-session-drawer__new-icon" aria-hidden="true" />
            New session
          </button>
          <button
            type="button"
            aria-label="Close sessions"
            className="aui-session-drawer__close"
            onClick={onClose}
          >
            <X className="aui-session-drawer__close-icon" aria-hidden="true" />
          </button>
        </div>

        <div className="aui-session-drawer__list">
          {sessions.length === 0 ? (
            <p className="aui-session-drawer__empty">No session yet.</p>
          ) : (
            sessions.map((session) => {
              const isActive = session.id === activeSessionId;
              const stamp = session.lastMessageAt ?? session.createdAt;
              return (
                <div
                  key={session.id}
                  data-testid="session-row"
                  data-session-id={session.id}
                  role="button"
                  tabIndex={0}
                  aria-current={isActive ? "true" : undefined}
                  className={`aui-session-row${isActive ? " aui-session-row--active" : ""}`}
                  onClick={() => {
                    onSelect(session.id);
                    onClose();
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    onSelect(session.id);
                    onClose();
                  }}
                >
                  <span className="aui-session-row__title">
                    {session.title.length > 0 ? session.title : UNTITLED}
                  </span>
                  <span className="aui-session-row__time">
                    {formatRelativeTime(stamp, now)}
                  </span>
                  <button
                    type="button"
                    data-testid="session-delete"
                    aria-label="Delete session"
                    className="aui-session-row__delete"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!window.confirm("Delete this session?")) return;
                      onDelete(session.id);
                    }}
                  >
                    <Trash2
                      className="aui-session-row__delete-icon"
                      aria-hidden="true"
                    />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
