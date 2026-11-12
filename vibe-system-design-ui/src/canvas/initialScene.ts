import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

type SceneSkeleton =
  | {
      type: "rectangle";
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
      label?: { text: string };
    }
  | {
      type: "arrow";
      id: string;
      x: number;
      y: number;
      points: [number, number][];
      start: { id: string };
      end: { id: string };
    };

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

type Box = (typeof BOXES)[number];

const boxCentre = (box: Box) => ({
  x: box.x + BOX_W / 2,
  y: box.y + BOX_H / 2,
});

// Point where the ray from the box centre toward `target` crosses the box border.
const edgeAnchor = (box: Box, target: { x: number; y: number }) => {
  const centre = boxCentre(box);
  const dx = target.x - centre.x;
  const dy = target.y - centre.y;
  const scaleX = dx === 0 ? Infinity : BOX_W / 2 / Math.abs(dx);
  const scaleY = dy === 0 ? Infinity : BOX_H / 2 / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);
  return { x: centre.x + dx * scale, y: centre.y + dy * scale };
};

const boxesById = new Map<string, Box>(BOXES.map((box) => [box.id, box]));

const boxFor = (id: string): Box => {
  const box = boxesById.get(id);
  if (!box) {
    throw new Error(`Unknown box id: ${id}`);
  }
  return box;
};

// Excalidraw does not route bound arrows from the `start`/`end` ids alone, so each
// arrow carries explicit geometry that begins and ends on the box borders.
export const INITIAL_SCENE_SKELETONS: SceneSkeleton[] = [
  ...BOXES.map((box) => ({
    type: "rectangle" as const,
    id: box.id,
    x: box.x,
    y: box.y,
    width: BOX_W,
    height: BOX_H,
    label: { text: `${box.label}\n${box.sublabel}` },
  })),
  ...EDGES.map((edge) => {
    const from = boxFor(edge.from);
    const to = boxFor(edge.to);
    const start = edgeAnchor(from, boxCentre(to));
    const end = edgeAnchor(to, boxCentre(from));
    const points: [number, number][] = [
      [0, 0],
      [end.x - start.x, end.y - start.y],
    ];
    return {
      type: "arrow" as const,
      id: edge.id,
      x: start.x,
      y: start.y,
      points,
      start: { id: edge.from },
      end: { id: edge.to },
    };
  }),
];

export function buildInitialScene(): { elements: ExcalidrawElement[] } {
  return { elements: convertToExcalidrawElements(INITIAL_SCENE_SKELETONS) };
}
