import { Excalidraw } from "@excalidraw/excalidraw";

export default function Canvas({ theme }: { theme: "light" | "dark" }) {
  return (
    <Excalidraw
      theme={theme}
      UIOptions={{ canvasActions: { toggleTheme: false } }}
    />
  );
}