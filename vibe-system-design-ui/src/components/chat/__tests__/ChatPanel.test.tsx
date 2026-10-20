import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ChatPanel } from "../ChatPanel";

afterEach(() => {
  document.documentElement.classList.remove("dark");
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
    const user = userEvent.setup();
    render(<ChatPanel />);
    const input = screen.getByRole("textbox", { name: /composer/i });
    await user.click(input);
    await user.keyboard("{Enter}");
    expect(screen.queryByTestId("user-message")).not.toBeInTheDocument();
  });

  it("renders user text in a primary bubble and assistant echo in a card bubble", async () => {
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
    expect(getComputedStyle(assistantMsg).backgroundColor).toBe(
      "rgb(255, 255, 255)",
    );
  });

  it("disables the send button while a local echo is running", async () => {
    const user = userEvent.setup();
    render(<ChatPanel />);
    const input = screen.getByRole("textbox", { name: /composer/i });
    const send = screen.getByRole("button", { name: /send message/i });

    await user.click(input);
    await user.keyboard("Hello");
    // Send is available while idle.
    expect(send).not.toBeDisabled();
    await user.keyboard("{Enter}");
    // Running (echo pending) disables send.
    expect(send).toBeDisabled();
  });

  it("flips chat surfaces to the Notion dark tokens when .dark is set", () => {
    document.documentElement.classList.add("dark");
    const { container } = render(<ChatPanel />);
    const panel = container.querySelector('[data-testid="chat-panel"]')!;
    expect(panel).toHaveClass("bg-background");
    expect(getComputedStyle(panel).backgroundColor).toBe("rgb(25, 25, 25)");
  });
});
