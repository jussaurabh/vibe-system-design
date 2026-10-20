import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SessionSummary } from "../../../lib/chat-api";
import { SessionDrawer } from "../SessionDrawer";

const SESSION_ONE: SessionSummary = {
  id: "ses_1",
  title: "One",
  createdAt: Date.now() - 60_000,
  updatedAt: Date.now() - 60_000,
  lastMessageAt: Date.now() - 60_000,
};

const SESSION_TWO: SessionSummary = {
  id: "ses_2",
  title: "",
  createdAt: Date.now() - 3_600_000,
  updatedAt: Date.now() - 3_600_000,
  lastMessageAt: null,
};

function renderDrawer(overrides: Partial<React.ComponentProps<typeof SessionDrawer>> = {}) {
  const props = {
    open: true,
    sessions: [SESSION_ONE, SESSION_TWO],
    activeSessionId: "ses_1",
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onDelete: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<SessionDrawer {...props} />);
  return props;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SessionDrawer", () => {
  it("lists the sessions", () => {
    renderDrawer();

    const rows = screen.getAllByTestId("session-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("One");
  });

  it("calls a session without a title untitled", () => {
    renderDrawer();

    expect(screen.getAllByTestId("session-row")[1]).toHaveTextContent(
      "Untitled session",
    );
  });

  it("marks the active session", () => {
    renderDrawer();

    const rows = screen.getAllByTestId("session-row");
    expect(rows[0]).toHaveAttribute("aria-current", "true");
    expect(rows[1]).not.toHaveAttribute("aria-current");
  });

  it("selects a session", async () => {
    const user = userEvent.setup();
    const props = renderDrawer();

    await user.click(screen.getAllByTestId("session-row")[1]);

    expect(props.onSelect).toHaveBeenCalledWith("ses_2");
    expect(props.onClose).toHaveBeenCalled();
  });

  it("creates a session", async () => {
    const user = userEvent.setup();
    const props = renderDrawer();

    await user.click(screen.getByTestId("session-new"));

    expect(props.onCreate).toHaveBeenCalled();
  });

  it("deletes a session", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const props = renderDrawer();

    await user.click(screen.getAllByTestId("session-delete")[0]);

    expect(props.onDelete).toHaveBeenCalledWith("ses_1");
  });

  it("does not delete a session when the confirmation is refused", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const props = renderDrawer();

    await user.click(screen.getAllByTestId("session-delete")[0]);

    expect(props.onDelete).not.toHaveBeenCalled();
  });

  it("closes on escape", async () => {
    const user = userEvent.setup();
    const props = renderDrawer();

    await user.keyboard("{Escape}");

    expect(props.onClose).toHaveBeenCalled();
  });

  it("renders nothing when it is closed", () => {
    renderDrawer({ open: false });

    expect(screen.queryByTestId("session-drawer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("session-drawer-backdrop")).not.toBeInTheDocument();
  });
});
