import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

type ExcalidrawElementSkeleton =
  | { type: "rectangle"; id: string; x: number; y: number; width: number; height: number; label?: { text: string } }
  | { type: "arrow"; id: string; x: number; y: number; start: { id: string }; end: { id: string } };

const BOX_W = 180;
const BOX_H = 72;

const BOXES = [
  { id: "client-apps", label: "Client Apps", sublabel: "web · mobile", x: 60, y: 180 },
  { id: "load-balancer", label: "Load Balancer", sublabel: "round robin", x: 280, y: 180 },
  { id: "web-server", label: "Web Server", sublabel: "2 vCPU · auto-scale", x: 500, y: 100 },
  { id: "worker-pool", label: "Worker Pool", sublabel: "async jobs · 4x", x: 500, y: 260 },
  { id: "postgresql", label: "PostgreSQL", sublabel: "primary store", x: 740, y: 180 },
] as const;

const EDGES = [
  { id: "e-client-lb", from: "client-apps", to: "load-balancer" },
  { id: "e-lb-web", from: "load-balancer", to: "web-server" },
  { id: "e-lb-worker", from: "load-balancer", to: "worker-pool" },
  { id: "e-web-db", from: "web-server", to: "postgresql" },
  { id: "e-worker-db", from: "worker-pool", to: "postgresql" },
] as const;

export const INITIAL_SCENE_SKELETONS: ExcalidrawElementSkeleton[] = [
  ...BOXES.map((b) => ({
    type: "rectangle" as const,
    id: b.id,
    x: b.x,
    y: b.y,
    width: BOX_W,
    height: BOX_H,
    label: { text: `${b.label}\n${b.sublabel}` },
  })),
  ...EDGES.map((e) => {
    const from = BOXES.find((b) => b.id === e.from)!;
    return {
      type: "arrow" as const,
      id: e.id,
      x: from.x + BOX_W,
      y: from.y + BOX_H / 2,
      start: { id: e.from },
      end: { id: e.to },
    };
  }),
];

export function buildInitialScene(): { elements: ExcalidrawElement[] } {
  return { elements: convertToExcalidrawElements(INITIAL_SCENE_SKELETONS) };
}