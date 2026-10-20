/**
 * The REST client of the chat sessions.
 *
 * The browser never touches the database. Every call goes through the
 * backend, on the same origin, so the Vite dev proxy forwards it and no CORS
 * preflight request happens.
 */

/** A session of the chat, as the backend returns it. */
export interface SessionSummary {
  readonly id: string;
  readonly title: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly lastMessageAt: number | null;
}

/** A stored message of a session, as the backend returns it. */
export interface StoredMessage {
  readonly id: string;
  readonly sessionId: string;
  readonly createdAt: number;
  readonly seq: number;
  readonly senderType: "user" | "assistant" | "system" | "tool";
  readonly content: { readonly type: string; readonly [key: string]: unknown }[];
  readonly status: "complete" | "incomplete" | "error";
  readonly tokenCount: number | null;
  readonly modelName: string | null;
  readonly latencyMs: number | null;
}

/**
 * Read the base URL of the backend.
 *
 * An empty base URL keeps the request on the origin of the page. The Vite dev
 * server proxies the path to the backend, so the browser sends one request
 * and no CORS preflight request.
 */
export function resolveBaseUrl(opts?: { baseUrl?: string }): string {
  if (opts?.baseUrl !== undefined) return opts.baseUrl;
  const env = import.meta.env?.VITE_API_BASE_URL;
  return typeof env === "string" ? env : "";
}

/** Throw an error that names the status when the answer is not ok. */
function assertOk(response: Response): void {
  if (!response.ok) {
    throw new Error(`The chat API failed with status ${response.status}.`);
  }
}

/** Send one request and read the JSON body of the answer. */
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response =
    init === undefined ? await fetch(url) : await fetch(url, init);
  assertOk(response);
  return (await response.json()) as T;
}

/** Read every session of the user, newest first. */
export async function listSessions(): Promise<SessionSummary[]> {
  const body = await request<{ sessions: SessionSummary[] }>(
    `${resolveBaseUrl()}/v1/chat/sessions`,
  );
  return body.sessions;
}

/** Create a session and return it. */
export async function createSession(): Promise<SessionSummary> {
  const body = await request<{ session: SessionSummary }>(
    `${resolveBaseUrl()}/v1/chat/sessions`,
    { method: "POST" },
  );
  return body.session;
}

/** Read one session by its id. */
export async function getSession(sessionId: string): Promise<SessionSummary> {
  const body = await request<{ session: SessionSummary }>(
    `${resolveBaseUrl()}/v1/chat/sessions/${sessionId}`,
  );
  return body.session;
}

/** Delete a session and its messages. */
export async function deleteSession(sessionId: string): Promise<void> {
  const response = await fetch(`${resolveBaseUrl()}/v1/chat/sessions/${sessionId}`, {
    method: "DELETE",
  });
  // The route answers 204, so there is no body to read.
  assertOk(response);
}

/** Read the messages of a session, in the order they were stored. */
export async function listMessages(sessionId: string): Promise<StoredMessage[]> {
  const body = await request<{ messages: StoredMessage[] }>(
    `${resolveBaseUrl()}/v1/chat/sessions/${sessionId}/messages`,
  );
  return body.messages;
}
