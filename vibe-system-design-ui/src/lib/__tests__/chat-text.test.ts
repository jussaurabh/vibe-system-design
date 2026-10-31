import { describe, expect, it } from "vitest";
import { stripUserPromptTags } from "../chat-text";

describe("stripUserPromptTags", () => {
  it("removes a whole-message wrapper and its surrounding newlines", () => {
    expect(stripUserPromptTags("<user_prompt>\nHello\nworld\n</user_prompt>")).toBe(
      "Hello\nworld",
    );
  });

  it("returns plain text unchanged", () => {
    expect(stripUserPromptTags("Hello\nworld")).toBe("Hello\nworld");
  });

  it("leaves a tag that is not a whole-message wrapper alone", () => {
    expect(stripUserPromptTags("Use <user_prompt> in docs")).toBe(
      "Use <user_prompt> in docs",
    );
  });
});