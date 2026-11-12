import { Excalidraw } from "@excalidraw/excalidraw";
import { buildInitialScene } from "./initialScene";

export default function Canvas({ theme }: { theme: "light" | "dark" }) {
  return (
    <Excalidraw
      theme={theme}
      UIOptions={{ canvasActions: { toggleTheme: false } }}
      initialData={{ elements: buildInitialScene().elements }}
    />
  );
}