import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "../ChatPanel";
import {
  createSseStream,
  dataFrame,
  mockFetch,
  mockFetchFrames,
} from "../../../test/sse-mock";

const DONE_FRAME = "event: done\ndata: {}\n\n";

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
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<ChatPanel />);
    const input = screen.getByRole("textbox", { name: /composer/i });
    await user.click(input);
    await user.keyboard("{Enter}");
    expect(screen.queryByTestId("user-message")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not send a whitespace only user message", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<ChatPanel />);
    const input = screen.getByRole("textbox", { name: /composer/i });
    await user.click(input);
    await user.keyboard("   {Enter}");
    expect(screen.queryByTestId("user-message")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders user text in a primary bubble and streamed text in a card bubble", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchFrames([
        dataFrame({ event: "message-start", id: "m-1", role: "ai" }),
        dataFrame({
          event: "content-block-delta",
          index: 0,
          delta: { type: "text-delta", text: "Hello from the backend" },
        }),
        DONE_FRAME,
      ]),
    );

    const user = userEvent.setup();
    render(<ChatPanel />);
    const input = screen.getByRole("textbox", { name: /composer/i });
    await user.click(input);
    await user.keyboard("Hello there{Enter}");

    const userMsg = await screen.findByTestId("user-message");
    expect(userMsg).toHaveClass("bg-primary");
    expect(getComputedStyle(userMsg).backgroundColor).toBe("rgb(0, 117, 222)");

    const assistantMsg = await screen.findByTestId(
      "assistant-message",
      {},
      { timeout: 3000 },
    );
    expect(assistantMsg).toHaveClass("bg-card");
    expect(getComputedStyle(assistantMsg).backgroundColor).toBe("rgb(255, 255, 255)");
    expect(assistantMsg).toHaveTextContent("Hello from the backend");
  });

  it("disables the composer while a stream is running", async () => {
    const stream = createSseStream();
    vi.stubGlobal("fetch", mockFetch(stream));

    const user = userEvent.setup();
    render(<ChatPanel />);
    const input = screen.getByRole("textbox", { name: /composer/i });
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
    vi.stubGlobal("fetch", mockFetch(stream));

    const user = userEvent.setup();
    render(<ChatPanel />);
    const input = screen.getByRole("textbox", { name: /composer/i });

    expect(screen.queryByTestId("chat-running")).not.toBeInTheDocument();
    await user.click(input);
    await user.keyboard("Hello{Enter}");

    expect(await screen.findByTestId("chat-running")).toBeInTheDocument();
  });

  it("stops the stream when the stop button runs", async () => {
    const stream = createSseStream();
    vi.stubGlobal("fetch", mockFetch(stream));

    const user = userEvent.setup();
    render(<ChatPanel />);
    const input = screen.getByRole("textbox", { name: /composer/i });
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
      mockFetchFrames(['event: error\ndata: {"message":"boom"}\n\n']),
    );

    const user = userEvent.setup();
    render(<ChatPanel />);
    const input = screen.getByRole("textbox", { name: /composer/i });
    await user.click(input);
    await user.keyboard("Hello{Enter}");

    const banner = await screen.findByTestId("chat-error");
    expect(banner).toHaveTextContent("boom");
    expect(banner).toHaveClass("text-destructive");
    expect(getComputedStyle(banner).color).toBe("rgb(221, 91, 0)");
  });

  it("shows an error banner when the backend returns an HTTP error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        body: new ReadableStream<Uint8Array>(),
      }),
    );

    const user = userEvent.setup();
    render(<ChatPanel />);
    const input = screen.getByRole("textbox", { name: /composer/i });
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
});
