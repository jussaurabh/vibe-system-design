import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "../ChatPanel";
import {
  createSseStream,
  dataFrame,
} from "../../../test/sse-mock";

const DONE_FRAME = "event: done\ndata: {}\n\n";

const SESSION = {
  id: "ses_test",
  title: "A session",
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  lastMessageAt: null,
};

const MARKDOWN_TABLE = [
  "| | Apple | Orange |",
  "|---|---|---|",
  "| **Taste** | Sweet to tart | Citrusy and tangy |",
  "| **Color** | Red, green, or yellow | Orange |",
].join("\n");

const MARKDOWN_DOC = [
  "## Differences",
  "",
  "- Sweet to tart",
  "- Citrusy and tangy",
  "",
  "Use `apple` for baking.",
].join("\n");

/**
 * Build a fetch mock that answers the session routes and serves the given
 * frames for the stream route.
 */
function mockApi(options: {
  sessions?: unknown[];
  frames?: string[];
  stream?: ReturnType<typeof createSseStream>;
}) {
  const sessions = options.sessions ?? [SESSION];
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/v1/chat/stream")) {
      if (options.stream) {
        init?.signal?.addEventListener("abort", () => options.stream?.abort());
        return {
          ok: true,
          status: 200,
          body: options.stream.body,
        } as unknown as Response;
      }
      const frames = options.frames ?? [DONE_FRAME];
      const stream = createSseStream();
      for (const frame of frames) stream.push(frame);
      stream.close();
      return {
        ok: true,
        status: 200,
        body: stream.body,
      } as unknown as Response;
    }
    if (url.includes("/messages")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: [] }),
      } as unknown as Response;
    }
    if (init?.method === "POST") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ session: SESSION }),
      } as unknown as Response;
    }
    if (url.endsWith("/v1/chat/sessions")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ sessions }),
      } as unknown as Response;
    }
    if (url.includes("/v1/chat/sessions/")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ session: SESSION }),
      } as unknown as Response;
    }
    return { ok: true, status: 204 } as unknown as Response;
  });
}

afterEach(() => {
  document.documentElement.classList.remove("dark");
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

describe("ChatPanel", () => {
  it("renders a composer input and a message list", () => {
    render(<ChatPanel />);
    expect(
      screen.getByRole("textbox", { name: /composer/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("chat-message-list")).toBeInTheDocument();
  });

  it("applies the Notion canvas background and hairline left border", () => {
    const { container } = render(<ChatPanel />);
    const panel = container.querySelector('[data-testid="chat-panel"]');
    expect(panel).toHaveClass("bg-background");
    expect(panel).toHaveClass("border-l");
    expect(panel).toHaveClass("border-border");
    // Light canvas resolves to the warm paper token.
    expect(getComputedStyle(panel!).backgroundColor).toBe("rgb(246, 245, 244)");
  });

  it("keeps the panel at 35% width beside the 65% canvas", () => {
    const { container } = render(<ChatPanel />);
    const panel = container.querySelector('[data-testid="chat-panel"]');
    expect(panel).toHaveClass("w-[35%]");
  });

  it("does not send an empty user message", async () => {
    const fetchMock = mockApi({});
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<ChatPanel />);
    const input = screen.getByRole("textbox", { name: /composer/i });
    await user.click(input);
    await user.keyboard("{Enter}");
    expect(screen.queryByTestId("user-message")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/v1/chat/stream",
      expect.anything(),
    );
  });

  it("does not send a whitespace only user message", async () => {
    const fetchMock = mockApi({});
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<ChatPanel />);
    const input = screen.getByRole("textbox", { name: /composer/i });
    await user.click(input);
    await user.keyboard("   {Enter}");
    expect(screen.queryByTestId("user-message")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/v1/chat/stream",
      expect.anything(),
    );
  });

  it("renders the user message in a bubble and the assistant message without one", async () => {
    vi.stubGlobal(
      "fetch",
      mockApi({
        frames: [
          dataFrame({ event: "message-start", id: "m-1", role: "ai" }),
          dataFrame({
            event: "content-block-delta",
            index: 0,
            delta: { type: "text-delta", text: "Hello from the backend" },
          }),
          DONE_FRAME,
        ],
      }),
    );

    const user = userEvent.setup();
    render(<ChatPanel />);
    // The composer is enabled once a session is open.
    const input = await screen.findByRole("textbox", { name: /composer/i });
    await waitFor(() => expect(input).not.toBeDisabled());
    await user.click(input);
    await user.keyboard("Hello there{Enter}");

    const userMsg = await screen.findByTestId("user-message");
    expect(userMsg).toHaveClass("aui-message--user");
    expect(userMsg).toHaveClass("bg-primary");
    expect(getComputedStyle(userMsg).backgroundColor).toBe("rgb(0, 117, 222)");

    const assistantMsg = await screen.findByTestId(
      "assistant-message",
      {},
      { timeout: 3000 },
    );
    expect(assistantMsg).toHaveClass("aui-message--assistant");
    expect(assistantMsg).not.toHaveClass("bg-card");
    expect(assistantMsg).not.toHaveClass("text-card-foreground");
    expect(assistantMsg).not.toHaveClass("border");
    expect(assistantMsg).toHaveTextContent("Hello from the backend");
  });

  it("hides reasoning and renders a chunked GFM table", async () => {
    const chunks = [
      MARKDOWN_TABLE.slice(0, 18),
      MARKDOWN_TABLE.slice(18, 64),
      MARKDOWN_TABLE.slice(64),
    ];

    vi.stubGlobal(
      "fetch",
      mockApi({
        frames: [
          dataFrame({ event: "message-start", id: "m-table", role: "ai" }),
          dataFrame({
            event: "content-block-start",
            index: 0,
            content: { type: "reasoning", reasoning: "" },
          }),
          dataFrame({
            event: "content-block-delta",
            index: 0,
            delta: {
              type: "reasoning-delta",
              reasoning: "The user wants a table.",
            },
          }),
          dataFrame({
            event: "content-block-finish",
            index: 0,
            content: { type: "reasoning", reasoning: "The user wants a table." },
          }),
          dataFrame({
            event: "content-block-start",
            index: 1,
            content: { type: "text", text: "" },
          }),
          ...chunks.map((text) =>
            dataFrame({
              event: "content-block-delta",
              index: 1,
              delta: { type: "text-delta", text },
            }),
          ),
          dataFrame({
            event: "content-block-finish",
            index: 1,
            content: { type: "text", text: MARKDOWN_TABLE },
          }),
          dataFrame({ event: "message-finish", reason: "stop" }),
          DONE_FRAME,
        ],
      }),
    );

    const user = userEvent.setup();
    render(<ChatPanel />);
    const input = await screen.findByRole("textbox", { name: /composer/i });
    await waitFor(() => expect(input).not.toBeDisabled());
    await user.click(input);
    await user.keyboard("Compare apples and oranges{Enter}");

    const table = await screen.findByRole("table", {}, { timeout: 3000 });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["", "Apple", "Orange"]);
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByText("Sweet to tart")).toBeInTheDocument();
    expect(screen.queryByText(/The user wants a table/)).not.toBeInTheDocument();
  });

  it("renders headings, lists, and inline code", async () => {
    vi.stubGlobal(
      "fetch",
      mockApi({
        frames: [
          dataFrame({ event: "message-start", id: "m-doc", role: "ai" }),
          dataFrame({
            event: "content-block-delta",
            index: 0,
            delta: { type: "text-delta", text: MARKDOWN_DOC },
          }),
          DONE_FRAME,
        ],
      }),
    );

    const user = userEvent.setup();
    render(<ChatPanel />);
    const input = await screen.findByRole("textbox", { name: /composer/i });
    await waitFor(() => expect(input).not.toBeDisabled());
    await user.click(input);
    await user.keyboard("Describe the difference{Enter}");

    // The runtime renders an optimistic placeholder while the stream runs and
    // replaces it with the settled message. Re-query the document, so the
    // assertions never read the stale placeholder node.
    await waitFor(
      () =>
        expect(screen.getByTestId("assistant-message")).toHaveTextContent(
          "Differences",
        ),
      { timeout: 3000 },
    );
    const message = screen.getByTestId("assistant-message");
    expect(
      within(message).getByRole("heading", {
        level: 2,
        name: "Differences",
      }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(within(message).getAllByRole("listitem")).toHaveLength(2),
    );
    expect(within(message).getByText("apple").tagName).toBe("CODE");
  });

  it("disables the composer while a stream is running", async () => {
    const stream = createSseStream();
    vi.stubGlobal("fetch", mockApi({ stream }));

    const user = userEvent.setup();
    render(<ChatPanel />);
    const input = await screen.findByRole("textbox", { name: /composer/i });
    await waitFor(() => expect(input).not.toBeDisabled());
    const send = screen.getByRole("button", { name: /send message/i });

    await user.click(input);
    await user.keyboard("Hello");
    // Send is available while idle.
    expect(send).not.toBeDisabled();
    await user.keyboard("{Enter}");
    // Running disables the composer.
    await waitFor(() => expect(send).toBeDisabled());
    expect(input).toBeDisabled();
  });

  it("shows a running indicator while a stream is running", async () => {
    const stream = createSseStream();
    vi.stubGlobal("fetch", mockApi({ stream }));

    const user = userEvent.setup();
    render(<ChatPanel />);
    const input = await screen.findByRole("textbox", { name: /composer/i });
    await waitFor(() => expect(input).not.toBeDisabled());

    expect(screen.queryByTestId("chat-running")).not.toBeInTheDocument();
    await user.click(input);
    await user.keyboard("Hello{Enter}");

    expect(await screen.findByTestId("chat-running")).toBeInTheDocument();
  });

  it("stops the stream when the stop button runs", async () => {
    const stream = createSseStream();
    vi.stubGlobal("fetch", mockApi({ stream }));

    const user = userEvent.setup();
    render(<ChatPanel />);
    const input = await screen.findByRole("textbox", { name: /composer/i });
    await waitFor(() => expect(input).not.toBeDisabled());
    await user.click(input);
    await user.keyboard("Hello{Enter}");

    const stop = await screen.findByRole("button", { name: /stop generating/i });
    await user.click(stop);

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /stop generating/i }),
      ).not.toBeInTheDocument(),
    );
  });

  it("shows an error banner when the stream fails", async () => {
    vi.stubGlobal(
      "fetch",
      mockApi({ frames: ['event: error\ndata: {"message":"boom"}\n\n'] }),
    );

    const user = userEvent.setup();
    render(<ChatPanel />);
    const input = await screen.findByRole("textbox", { name: /composer/i });
    await waitFor(() => expect(input).not.toBeDisabled());
    await user.click(input);
    await user.keyboard("Hello{Enter}");

    const banner = await screen.findByTestId("chat-error");
    expect(banner).toHaveTextContent("boom");
    expect(banner).toHaveClass("text-destructive");
    expect(getComputedStyle(banner).color).toBe("rgb(221, 91, 0)");
  });

  it("shows an error banner when the backend returns an HTTP error", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/v1/chat/stream")) {
        return {
          ok: false,
          status: 500,
          body: new ReadableStream<Uint8Array>(),
        } as unknown as Response;
      }
      return mockApi({})(url);
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<ChatPanel />);
    const input = await screen.findByRole("textbox", { name: /composer/i });
    await waitFor(() => expect(input).not.toBeDisabled());
    await user.click(input);
    await user.keyboard("Hello{Enter}");

    const banner = await screen.findByTestId("chat-error");
    expect(banner).toHaveTextContent(/500/);
  });

  it("flips chat surfaces to the Notion dark tokens when .dark is set", () => {
    document.documentElement.classList.add("dark");
    const { container } = render(<ChatPanel />);
    const panel = container.querySelector('[data-testid="chat-panel"]')!;
    expect(panel).toHaveClass("bg-background");
    expect(getComputedStyle(panel).backgroundColor).toBe("rgb(25, 25, 25)");
  });

  it("opens the drawer from the menu button", async () => {
    const user = userEvent.setup();
    render(<ChatPanel />);

    expect(screen.queryByTestId("session-drawer")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("chat-menu"));
    expect(screen.getByTestId("session-drawer")).toBeInTheDocument();
  });

  it("shows the title of the active session", async () => {
    vi.stubGlobal("fetch", mockApi({}));
    render(<ChatPanel />);

    await waitFor(() =>
      expect(screen.getByTestId("chat-session-title")).toHaveTextContent(
        "A session",
      ),
    );
  });

  it("creates a session when the list is empty", async () => {
    const fetchMock = mockApi({ sessions: [] });
    vi.stubGlobal("fetch", fetchMock);

    render(<ChatPanel />);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/v1/chat/sessions",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("reads the session again after a run", async () => {
    const fetchMock = mockApi({
      frames: [
        dataFrame({ event: "message-start", id: "m-1", role: "ai" }),
        DONE_FRAME,
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<ChatPanel />);
    const input = await screen.findByRole("textbox", { name: /composer/i });
    await waitFor(() => expect(input).not.toBeDisabled());
    await user.click(input);
    await user.keyboard("Hello{Enter}");

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/v1/chat/sessions/ses_test"),
    );
  });

  it("shows an error banner when the session list fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      }),
    );

    render(<ChatPanel />);

    const banner = await screen.findByTestId("chat-error");
    expect(banner).toHaveTextContent(/500/);
  });
});
