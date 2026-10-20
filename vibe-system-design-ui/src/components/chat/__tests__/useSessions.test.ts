import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SessionSummary, StoredMessage } from "../../../lib/chat-api";
import { useSessions } from "../useSessions";

const SESSION_ONE: SessionSummary = {
  id: "ses_1",
  title: "One",
  createdAt: 1000,
  updatedAt: 1000,
  lastMessageAt: null,
};

const SESSION_TWO: SessionSummary = {
  id: "ses_2",
  title: "Two",
  createdAt: 2000,
  updatedAt: 2000,
  lastMessageAt: null,
};

const MESSAGE: StoredMessage = {
  id: "msg_1",
  sessionId: "ses_1",
  createdAt: 1000,
  seq: 1,
  senderType: "user",
  content: [{ type: "text", text: "hi" }],
  status: "complete",
  tokenCount: null,
  modelName: null,
  latencyMs: null,
};

/** Build a JSON response for the fetch mock. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** Build a fetch mock that answers the session routes. */
function routeFetch(options: {
  sessions?: SessionSummary[];
  messages?: StoredMessage[];
  created?: SessionSummary;
}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      return jsonResponse({ session: options.created });
    }
    if (url.includes("/messages")) {
      return jsonResponse({ messages: options.messages ?? [] });
    }
    if (url.endsWith("/v1/chat/sessions")) {
      return jsonResponse({ sessions: options.sessions ?? [] });
    }
    return jsonResponse(undefined, 204);
  });
}

describe("useSessions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens the first session on load", async () => {
    const fetchMock = routeFetch({ sessions: [SESSION_ONE, SESSION_TWO] });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSessions());

    await waitFor(() => expect(result.current.activeSessionId).toBe("ses_1"));
    expect(fetchMock).toHaveBeenCalledWith("/v1/chat/sessions/ses_1/messages");
  });

  it("creates a session when the list is empty", async () => {
    const created: SessionSummary = {
      id: "ses_new",
      title: "",
      createdAt: 3000,
      updatedAt: 3000,
      lastMessageAt: null,
    };
    const fetchMock = routeFetch({ sessions: [], created });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSessions());

    await waitFor(() => expect(result.current.activeSessionId).toBe("ses_new"));
    expect(fetchMock).toHaveBeenCalledWith(
      "/v1/chat/sessions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("hands the loaded messages to the callback", async () => {
    vi.stubGlobal("fetch", routeFetch({ sessions: [SESSION_ONE], messages: [MESSAGE] }));
    const onMessages = vi.fn();

    const { result } = renderHook(() => useSessions({ onMessages }));

    await waitFor(() => expect(onMessages).toHaveBeenCalledWith([MESSAGE]));
    expect(result.current.activeSessionId).toBe("ses_1");
  });

  it("removes a session", async () => {
    const fetchMock = routeFetch({ sessions: [SESSION_ONE, SESSION_TWO] });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSessions());
    await waitFor(() => expect(result.current.activeSessionId).toBe("ses_1"));

    await act(async () => {
      await result.current.removeSession("ses_1");
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/v1/chat/sessions/ses_1",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(result.current.sessions.map((session) => session.id)).toEqual(["ses_2"]);
  });
});
