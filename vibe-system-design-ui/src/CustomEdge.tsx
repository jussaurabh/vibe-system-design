import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  type EdgeProps,
} from "@xyflow/react";

export type CustomEdgeData = {
  label?: string;
  bendOffset?: { x: number; y: number };
  labelT?: number;
};

function parseCubicPath(pathStr: string) {
  const parts = pathStr.match(
    /M\s*([\d.-]+)[\s,]+([\d.-]+)\s*C\s*([\d.-]+)[\s,]+([\d.-]+)\s*([\d.-]+)[\s,]+([\d.-]+)\s*([\d.-]+)[\s,]+([\d.-]+)/,
  );
  if (!parts) return null;
  return {
    p0: [+parts[1], +parts[2]] as [number, number],
    p1: [+parts[3], +parts[4]] as [number, number],
    p2: [+parts[5], +parts[6]] as [number, number],
    p3: [+parts[7], +parts[8]] as [number, number],
  };
}

function getCubicPoint(
  t: number,
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
) {
  const inv = 1 - t;
  const inv2 = inv * inv;
  const inv3 = inv2 * inv;
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: inv3 * p0[0] + 3 * inv2 * t * p1[0] + 3 * inv * t2 * p2[0] + t3 * p3[0],
    y: inv3 * p0[1] + 3 * inv2 * t * p1[1] + 3 * inv * t2 * p2[1] + t3 * p3[1],
  };
}

function getQuadraticPoint(
  t: number,
  sx: number,
  sy: number,
  cx: number,
  cy: number,
  tx: number,
  ty: number,
) {
  const inv = 1 - t;
  return {
    x: inv * inv * sx + 2 * inv * t * cx + t * t * tx,
    y: inv * inv * sy + 2 * inv * t * cy + t * t * ty,
  };
}

export default function CustomEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerStart,
  markerEnd,
  data,
  selected,
}: EdgeProps<any>) {
  const { setEdges, screenToFlowPosition } = useReactFlow();

  const [isHovered, setIsHovered] = useState(false);
  const [isHandleHovered, setIsHandleHovered] = useState(false);
  const [isBending, setIsBending] = useState(false);
  const [isDraggingLine, setIsDraggingLine] = useState(false);
  const [isDraggingLabel, setIsDraggingLabel] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(data?.label || "");

  const dragStartRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const labelDragStartRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing) {
      setEditText(data?.label || "");
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }, 10);
    }
  }, [isEditing, data?.label]);

  const mx = (sourceX + targetX) / 2;
  const my = (sourceY + targetY) / 2;

  const bendOffset = data?.bendOffset;
  const isBent = !!bendOffset;

  let edgePath = "";
  let bendPointX = mx;
  let bendPointY = my;

  if (isBent) {
    bendPointX = mx + bendOffset.x;
    bendPointY = my + bendOffset.y;
    const cx = 2 * bendPointX - mx;
    const cy = 2 * bendPointY - my;
    edgePath = `M ${sourceX},${sourceY} Q ${cx},${cy} ${targetX},${targetY}`;
  } else {
    const [bezierPath, defaultLabelX, defaultLabelY] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });
    edgePath = bezierPath;
    bendPointX = defaultLabelX;
    bendPointY = defaultLabelY;
  }

  // Calculate point on edge curve given t in [0, 1]
  const getPointOnCurve = useCallback(
    (t: number) => {
      if (isBent) {
        const cx = 2 * bendPointX - mx;
        const cy = 2 * bendPointY - my;
        return getQuadraticPoint(t, sourceX, sourceY, cx, cy, targetX, targetY);
      }
      const cubic = parseCubicPath(edgePath);
      if (cubic) {
        return getCubicPoint(t, cubic.p0, cubic.p1, cubic.p2, cubic.p3);
      }
      return {
        x: sourceX + (targetX - sourceX) * t,
        y: sourceY + (targetY - sourceY) * t,
      };
    },
    [isBent, bendPointX, bendPointY, mx, my, sourceX, sourceY, targetX, targetY, edgePath],
  );

  // Project any (px, py) coordinate onto the edge line to find closest t
  const findClosestT = useCallback(
    (px: number, py: number) => {
      const steps = 40;
      let bestT = 0.5;
      let bestDist = Infinity;

      for (let i = 0; i <= steps; i++) {
        const t = 0.06 + (i / steps) * (0.94 - 0.06);
        const pt = getPointOnCurve(t);
        const dist = (pt.x - px) ** 2 + (pt.y - py) ** 2;
        if (dist < bestDist) {
          bestDist = dist;
          bestT = t;
        }
      }

      // Refine with ternary search around bestT
      const stepSize = (0.94 - 0.06) / steps;
      let low = Math.max(0.06, bestT - stepSize);
      let high = Math.min(0.94, bestT + stepSize);

      for (let i = 0; i < 6; i++) {
        const m1 = low + (high - low) / 3;
        const m2 = high - (high - low) / 3;
        const pt1 = getPointOnCurve(m1);
        const pt2 = getPointOnCurve(m2);
        const d1 = (pt1.x - px) ** 2 + (pt1.y - py) ** 2;
        const d2 = (pt2.x - px) ** 2 + (pt2.y - py) ** 2;
        if (d1 < d2) {
          high = m2;
        } else {
          low = m1;
        }
      }

      return (low + high) / 2;
    },
    [getPointOnCurve],
  );

  // Label position is strictly clamped and evaluated along the edge curve
  const labelT = data?.labelT ?? 0.5;
  const { x: labelX, y: labelY } = getPointOnCurve(labelT);

  // Bend handle interaction
  const handleBendPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setIsBending(true);
  };

  const handleBendPointerMove = (e: React.PointerEvent) => {
    if (!isBending) return;
    const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const newOffset = {
      x: flowPos.x - mx,
      y: flowPos.y - my,
    };
    setEdges((edges) =>
      edges.map((edge) =>
        edge.id === id
          ? {
              ...edge,
              data: {
                ...edge.data,
                bendOffset: newOffset,
              },
            }
          : edge,
      ),
    );
  };

  const handleBendPointerUp = (e: React.PointerEvent) => {
    if (isBending) {
      setIsBending(false);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  const handleBendDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEdges((edges) =>
      edges.map((edge) => {
        if (edge.id === id) {
          const nextData = { ...edge.data };
          delete nextData.bendOffset;
          return {
            ...edge,
            data: nextData,
          };
        }
        return edge;
      }),
    );
  };

  // Direct edge line dragging and double-click
  const handleEdgePointerDown = (e: React.PointerEvent) => {
    dragStartRef.current = { clientX: e.clientX, clientY: e.clientY };
    (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
  };

  const handleEdgePointerMove = (e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    const dist = Math.hypot(
      e.clientX - dragStartRef.current.clientX,
      e.clientY - dragStartRef.current.clientY,
    );
    if (!isDraggingLine && dist > 4) {
      setIsDraggingLine(true);
    }
    if (isDraggingLine || dist > 4) {
      const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const newOffset = {
        x: flowPos.x - mx,
        y: flowPos.y - my,
      };
      setEdges((edges) =>
        edges.map((edge) =>
          edge.id === id
            ? {
                ...edge,
                data: {
                  ...edge.data,
                  bendOffset: newOffset,
                },
              }
            : edge,
        ),
      );
    }
  };

  const handleEdgePointerUp = (e: React.PointerEvent) => {
    dragStartRef.current = null;
    setIsDraggingLine(false);
    try {
      (e.currentTarget as SVGElement).releasePointerCapture(e.pointerId);
    } catch {}
  };

  const handleEdgeDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const initialT = findClosestT(flowPos.x, flowPos.y);
    setEdges((edges) =>
      edges.map((edge) =>
        edge.id === id
          ? {
              ...edge,
              data: {
                ...edge.data,
                labelT: initialT,
              },
            }
          : edge,
      ),
    );
    setIsEditing(true);
  };

  // Label dragging interaction locked strictly to the edge curve
  const handleLabelPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    labelDragStartRef.current = { clientX: e.clientX, clientY: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setIsDraggingLabel(true);
  };

  const handleLabelPointerMove = (e: React.PointerEvent) => {
    if (!isDraggingLabel || !labelDragStartRef.current) return;
    const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const newT = findClosestT(flowPos.x, flowPos.y);
    setEdges((edges) =>
      edges.map((edge) =>
        edge.id === id
          ? {
              ...edge,
              data: {
                ...edge.data,
                labelT: newT,
              },
            }
          : edge,
      ),
    );
  };

  const handleLabelPointerUp = (e: React.PointerEvent) => {
    if (isDraggingLabel) {
      setIsDraggingLabel(false);
      labelDragStartRef.current = null;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  const saveLabel = (text: string) => {
    const trimmed = text.trim();
    setEdges((edges) =>
      edges.map((edge) => {
        if (edge.id === id) {
          const nextData = { ...edge.data };
          if (trimmed.length > 0) {
            nextData.label = trimmed;
          } else {
            delete nextData.label;
          }
          return {
            ...edge,
            data: nextData,
          };
        }
        return edge;
      }),
    );
    setIsEditing(false);
  };

  const label = data?.label;
  const showBendHandle =
    isHovered ||
    isHandleHovered ||
    isBending ||
    isDraggingLine ||
    selected ||
    isBent;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={style}
        markerStart={markerStart}
        markerEnd={markerEnd}
        interactionWidth={0}
      />

      {/* Invisible wider interaction path for edge hovering, dragging to bend, and double click */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        className="react-flow__edge-interaction cursor-pointer"
        onPointerEnter={() => setIsHovered(true)}
        onPointerLeave={() => {
          if (!isBending && !isDraggingLine) setIsHovered(false);
        }}
        onPointerDown={handleEdgePointerDown}
        onPointerMove={handleEdgePointerMove}
        onPointerUp={handleEdgePointerUp}
        onDoubleClick={handleEdgeDoubleClick}
      />

      <EdgeLabelRenderer>
        {/* Draggable Bend Control Handle */}
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${bendPointX}px, ${bendPointY}px)`,
            pointerEvents: "all",
          }}
          className="nodrag nopan"
        >
          <div
            onPointerDown={handleBendPointerDown}
            onPointerMove={handleBendPointerMove}
            onPointerUp={handleBendPointerUp}
            onDoubleClick={handleBendDoubleClick}
            onPointerEnter={() => setIsHandleHovered(true)}
            onPointerLeave={() => setIsHandleHovered(false)}
            title="Drag to bend edge, double-click to reset"
            className={`w-6 h-6 flex items-center justify-center cursor-grab active:cursor-grabbing transition-opacity duration-150 ${
              showBendHandle
                ? isBent && !isHovered && !isHandleHovered && !selected
                  ? "opacity-60 hover:opacity-100"
                  : "opacity-100"
                : "opacity-0 pointer-events-none"
            }`}
          >
            <div className="w-2.5 h-2.5 rounded-full bg-white dark:bg-[#202020] border-[1.5px] border-[#0075de] shadow-sm hover:scale-125 transition-transform" />
          </div>
        </div>

        {/* Movable & Editable Edge Text Label strictly locked to edge path */}
        {(label || isEditing) && (
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
            }}
            className="nodrag nopan"
          >
            {isEditing ? (
              <textarea
                ref={inputRef}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onBlur={() => saveLabel(editText)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    saveLabel(editText);
                  }
                }}
                placeholder="Edge label..."
                rows={Math.max(1, editText.split("\n").length)}
                className="px-2.5 py-1 text-xs font-medium rounded-[6px] bg-white dark:bg-[#202020] text-black dark:text-white border border-[#0075de] ring-1 ring-[#0075de] shadow-md outline-none min-w-[70px] max-w-[220px] resize-none overflow-hidden whitespace-pre-wrap text-center leading-tight block"
                autoFocus
              />
            ) : (
              <div
                onPointerDown={handleLabelPointerDown}
                onPointerMove={handleLabelPointerMove}
                onPointerUp={handleLabelPointerUp}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setIsEditing(true);
                }}
                title="Slide along edge, double-click to edit"
                className="px-2.5 py-0.5 rounded-[6px] bg-white dark:bg-[#202020] text-black dark:text-white border border-[#e6e6e6] dark:border-[#2f2f2f] hover:border-[#0075de]/50 dark:hover:border-[#0075de]/50 shadow-[0px_0.175px_1.041px_0px_rgba(0,0,0,0.01),0px_0.8px_2.925px_0px_rgba(0,0,0,0.02),0px_2.025px_7.847px_0px_rgba(0,0,0,0.027)] cursor-grab active:cursor-grabbing select-none text-xs font-medium transition-colors whitespace-pre-wrap text-center leading-tight"
              >
                {label}
              </div>
            )}
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}
