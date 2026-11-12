// @vitest-environment jsdom
import "jest-canvas-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildInitialScene } from "./initialScene";
import {
  SCENE_STORAGE_KEY,
  createSceneSaver,
  loadSavedScene,
  saveScene,
} from "./sceneStorage";
import type { ExcalidrawArrowElement } from "@excalidraw/excalidraw/element/types";

const appState = { viewBackgroundColor: "#ffffff" } as const;

describe("loadSavedScene", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("returns null when no scene is saved", () => {
    expect(loadSavedScene()).toBeNull();
  });

  it("round-trips the demo scene preserving arrow bindings", () => {
    const { elements } = buildInitialScene();
    saveScene(elements, appState);
    const loaded = loadSavedScene()!;
    expect(loaded.elements.map((e) => e.id)).toEqual(elements.map((e) => e.id));
    const arrows = loaded.elements.filter((e) => e.type === "arrow") as ExcalidrawArrowElement[];
    const original = elements.filter((e) => e.type === "arrow") as ExcalidrawArrowElement[];
    expect(arrows.map((a) => a.startBinding!.elementId)).toEqual(
      original.map((a) => a.startBinding!.elementId),
    );
    expect(arrows.map((a) => a.endBinding!.elementId)).toEqual(
      original.map((a) => a.endBinding!.elementId),
    );
    expect(loaded.elements.some((e) => e.type === "text" && e.text.includes("PostgreSQL"))).toBe(true);
  });

  it("returns null for corrupted JSON", () => {
    localStorage.setItem(SCENE_STORAGE_KEY, "{not json");
    expect(loadSavedScene()).toBeNull();
  });

  it("returns null for JSON that is not an excalidraw scene", () => {
    localStorage.setItem(SCENE_STORAGE_KEY, JSON.stringify({ type: "other" }));
    expect(loadSavedScene()).toBeNull();
  });

  it("respects a saved empty scene instead of the demo scene", () => {
    saveScene([], appState);
    const loaded = loadSavedScene()!;
    expect(loaded.elements).toHaveLength(0);
  });
});

describe("createSceneSaver", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it("debounces a burst of saves into one write, last payload wins", () => {
    const saver = createSceneSaver();
    const { elements } = buildInitialScene();
    saver.save(elements.slice(0, 3), appState);
    saver.save(elements.slice(0, 5), appState);
    saver.save(elements, appState);
    expect(localStorage.getItem(SCENE_STORAGE_KEY)).toBeNull();
    vi.advanceTimersByTime(500);
    const loaded = loadSavedScene()!;
    expect(loaded.elements).toHaveLength(elements.length);
  });

  it("flush writes immediately without waiting for the timer", () => {
    const saver = createSceneSaver();
    const { elements } = buildInitialScene();
    saver.save(elements, appState);
    saver.flush();
    expect(loadSavedScene()).not.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});