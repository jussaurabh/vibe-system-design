import { useEffect, useMemo } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import { buildInitialScene } from "./initialScene";
import { createSceneSaver, loadSavedScene } from "./sceneStorage";

export default function Canvas({ theme }: { theme: "light" | "dark" }) {
  const saver = useMemo(() => createSceneSaver(), []);
  const initialData = useMemo(
    () => loadSavedScene() ?? { elements: buildInitialScene().elements },
    [],
  );

  useEffect(() => {
    const flush = () => saver.flush();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      saver.flush();
    };
  }, [saver]);

  return (
    <Excalidraw
      theme={theme}
      UIOptions={{ canvasActions: { toggleTheme: false } }}
      initialData={initialData}
      onChange={(elements, appState) => saver.save(elements, appState)}
    />
  );
}