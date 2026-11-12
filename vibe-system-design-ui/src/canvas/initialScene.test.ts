// @vitest-environment jsdom
import "jest-canvas-mock";
import { describe, expect, it } from "vitest";
import { buildInitialScene } from "./initialScene";
import type { ExcalidrawArrowElement } from "@excalidraw/excalidraw/element/types";

describe("buildInitialScene", () => {
  it("builds 5 rectangles, 5 arrows and 5 bound labels", () => {
    const { elements } = buildInitialScene();
    expect(elements.filter((e) => e.type === "rectangle")).toHaveLength(5);
    expect(elements.filter((e) => e.type === "arrow")).toHaveLength(5);
    expect(elements.filter((e) => e.type === "text")).toHaveLength(5);
  });

  it("binds every arrow to two existing rectangles", () => {
    const { elements } = buildInitialScene();
    const rectIds = new Set(
      elements.filter((e) => e.type === "rectangle").map((e) => e.id),
    );
    for (const arrow of elements.filter((e) => e.type === "arrow")) {
      const arrowElement = arrow as ExcalidrawArrowElement;
      expect(rectIds.has(arrowElement.startBinding!.elementId)).toBe(true);
      expect(rectIds.has(arrowElement.endBinding!.elementId)).toBe(true);
    }
  });

  it("keeps the PostgreSQL node in the scene", () => {
    const { elements } = buildInitialScene();
    const texts = elements.filter((e) => e.type === "text");
    expect(texts.some((t) => t.text.includes("PostgreSQL"))).toBe(true);
  });
});