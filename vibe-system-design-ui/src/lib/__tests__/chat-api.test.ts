import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createSession,
  deleteSession,
  listMessages,
  listSessions,
  stopChatStream,
} from "../chat-api";

/** Build a JSON response for the fetch mock. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("chat api", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists the sessions", async () => {
    const sessions = [{ id: "ses_1", title: "One" }];
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ sessions }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listSessions()).resolves.toEqual(sessions);
    expect(fetchMock).toHaveBeenCalledWith("/v1/chat/sessions");
  });

  it("creates a session", async () => {
    const session = { id: "ses_1", title: "" };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ session }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createSession()).resolves.toEqual(session);
    expect(fetchMock).toHaveBeenCalledWith(
      "/v1/chat/sessions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("deletes a session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(undefined, 204));
    vi.stubGlobal("fetch", fetchMock);

    await deleteSession("ses_1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/v1/chat/sessions/ses_1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("lists the messages of a session", async () => {
    const messages = [{ id: "msg_1", sessionId: "ses_1" }];
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ messages }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listMessages("ses_1")).resolves.toEqual(messages);
    expect(fetchMock).toHaveBeenCalledWith("/v1/chat/sessions/ses_1/messages");
  });

  it("throws an error that names the status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 500));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listSessions()).rejects.toThrow(/500/);
  });

  it("stops the stream of a session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(undefined, 204));
    vi.stubGlobal("fetch", fetchMock);

    await stopChatStream("ses_1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/v1/chat/sessions/ses_1/stop",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws when the stop request fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 500));
    vi.stubGlobal("fetch", fetchMock);

    await expect(stopChatStream("ses_1")).rejects.toThrow(/500/);
  });
});
