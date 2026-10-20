import { useCallback, useEffect, useRef, useState } from "react";

import {
  createSession as createSessionApi,
  deleteSession as deleteSessionApi,
  getSession as getSessionApi,
  listMessages as listMessagesApi,
  listSessions as listSessionsApi,
  type SessionSummary,
  type StoredMessage,
} from "../../lib/chat-api";

/** The shape returned by {@link useSessions}. */
export interface SessionsAPI {
  readonly sessions: readonly SessionSummary[];
  readonly activeSessionId: string | null;
  readonly isLoading: boolean;
  readonly error: Error | null;
  selectSession(sessionId: string): Promise<void>;
  createSession(): Promise<void>;
  removeSession(sessionId: string): Promise<void>;
  refresh(): Promise<void>;
  refreshSession(sessionId: string): Promise<void>;
}

/**
 * The hook owns the session list, the active session, and the calls that
 * create, select, and delete a session.
 *
 * On mount it loads the list. An empty list creates a session. A list with
 * entries opens the first one, because the backend returns the list already
 * ordered by the newest activity.
 */
export function useSessions(options?: {
  onMessages?: (messages: StoredMessage[]) => void;
}): SessionsAPI {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // The ref holds the callback. The hook keeps a stable identity when the
  // caller passes a new options object on every render.
  const onMessagesRef = useRef(options?.onMessages);
  useEffect(() => {
    onMessagesRef.current = options?.onMessages;
  }, [options?.onMessages]);

  /** Run one call and record its failure. */
  const run = useCallback(async (call: () => Promise<void>): Promise<void> => {
    setIsLoading(true);
    try {
      await call();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const selectSession = useCallback(
    async (sessionId: string): Promise<void> => {
      setActiveSessionId(sessionId);
      const messages = await listMessagesApi(sessionId);
      onMessagesRef.current?.(messages);
    },
    [],
  );

  const createSession = useCallback(async (): Promise<void> => {
    const session = await createSessionApi();
    setSessions((previous) => [session, ...previous]);
    await selectSession(session.id);
  }, [selectSession]);

  const refresh = useCallback(async (): Promise<void> => {
    const list = await listSessionsApi();
    setSessions(list);
    if (list.length === 0) {
      await createSession();
      return;
    }
    await selectSession(list[0].id);
  }, [createSession, selectSession]);

  const removeSession = useCallback(
    async (sessionId: string): Promise<void> => {
      await deleteSessionApi(sessionId);
      const remaining = sessions.filter((session) => session.id !== sessionId);
      setSessions(remaining);
      if (remaining.length === 0) {
        await createSession();
        return;
      }
      await selectSession(remaining[0].id);
    },
    [createSession, selectSession, sessions],
  );

  /**
   * Read one session again and replace it in the list. The backend renames a
   * session after its first message and moves its last message time, so the
   * list is stale after a run.
   */
  const refreshSession = useCallback(async (sessionId: string): Promise<void> => {
    const session = await getSessionApi(sessionId);
    setSessions((previous) =>
      previous.map((entry) => (entry.id === session.id ? session : entry)),
    );
  }, []);

  useEffect(() => {
    void run(refresh);
    // The hook loads the list once, when it mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    sessions,
    activeSessionId,
    isLoading,
    error,
    selectSession: (sessionId: string) => run(() => selectSession(sessionId)),
    createSession: () => run(createSession),
    removeSession: (sessionId: string) => run(() => removeSession(sessionId)),
    refresh: () => run(refresh),
    refreshSession: (sessionId: string) => run(() => refreshSession(sessionId)),
  };
}
