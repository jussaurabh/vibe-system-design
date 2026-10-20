import { describe, expect, it } from "vitest";

import { formatRelativeTime } from "../relative-time";

describe("formatRelativeTime", () => {
  const now = 1_700_000_000_000;

  it("calls a moment under a minute just now", () => {
    expect(formatRelativeTime(now - 30_000, now)).toBe("just now");
  });

  it("counts the minutes", () => {
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5m ago");
  });

  it("counts the hours", () => {
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
  });

  it("calls yesterday yesterday", () => {
    expect(formatRelativeTime(now - 30 * 3_600_000, now)).toBe("Yesterday");
  });

  it("counts the days", () => {
    expect(formatRelativeTime(now - 4 * 86_400_000, now)).toBe("4d ago");
  });

  it("falls back to the date", () => {
    expect(formatRelativeTime(now - 30 * 86_400_000, now)).toMatch(
      /^[A-Z][a-z]{2} \d{1,2}$/,
    );
  });
});
