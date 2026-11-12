import { restoreElements, serializeAsJSON } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

export const SCENE_STORAGE_KEY = "vibe-canvas-scene";

export function saveScene(
  elements: readonly ExcalidrawElement[],
  appState: Partial<AppState>,
): void {
  localStorage.setItem(
    SCENE_STORAGE_KEY,
    serializeAsJSON(elements, appState as AppState, {}, "local"),
  );
}

export function loadSavedScene():
  | { elements: ExcalidrawElement[]; appState?: Partial<AppState> }
  | null {
  const raw = localStorage.getItem(SCENE_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      type?: string;
      elements?: unknown[];
      appState?: Partial<AppState>;
    };
    if (parsed.type !== "excalidraw" || !Array.isArray(parsed.elements)) {
      return null;
    }
    return {
      elements: restoreElements(parsed.elements as ExcalidrawElement[], null, { repairBindings: true }),
      appState: parsed.appState,
    };
  } catch {
    return null;
  }
}

export function createSceneSaver(delayMs = 500) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: {
    elements: readonly ExcalidrawElement[];
    appState: Partial<AppState>;
  } | null = null;
  const write = () => {
    if (pending) {
      saveScene(pending.elements, pending.appState);
      pending = null;
    }
  };
  return {
    save(elements: readonly ExcalidrawElement[], appState: Partial<AppState>) {
      pending = { elements, appState };
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        write();
      }, delayMs);
    },
    flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      write();
    },
  };
}