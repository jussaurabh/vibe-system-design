import { useCallback, useRef, useMemo, useState, useEffect } from "react";
import {
  ReactFlow,
  useNodesState,
  useEdgesState,
  addEdge,
  useReactFlow,
  ReactFlowProvider,
  Panel,
  type Node,
  type Edge,
} from "@xyflow/react";
import { Sun, Moon, Search } from "lucide-react";
import CustomNode from "./CustomNode";
import CustomEdge from "./CustomEdge";
import { ChatPanel } from "./components/chat/ChatPanel";

const initialNodes: Node[] = [
  {
    id: "client-apps",
    type: "custom",
    data: { label: "Client Apps", sublabel: "web · mobile" },
    position: { x: 60, y: 180 },
  },
  {
    id: "load-balancer",
    type: "custom",
    data: { label: "Load Balancer", sublabel: "round robin" },
    position: { x: 280, y: 180 },
  },
  {
    id: "web-server",
    type: "custom",
    data: { label: "Web Server", sublabel: "2 vCPU · auto-scale" },
    position: { x: 500, y: 100 },
  },
  {
    id: "worker-pool",
    type: "custom",
    data: { label: "Worker Pool", sublabel: "async jobs · 4x" },
    position: { x: 500, y: 260 },
  },
  {
    id: "postgresql",
    type: "custom",
    data: { label: "PostgreSQL", sublabel: "primary store" },
    position: { x: 740, y: 180 },
  },
];

const initialEdges: Edge[] = [
  {
    id: "e-client-lb",
    source: "client-apps",
    sourceHandle: "right",
    target: "load-balancer",
    targetHandle: "left",
    type: "custom",
  },
  {
    id: "e-lb-web",
    source: "load-balancer",
    sourceHandle: "right",
    target: "web-server",
    targetHandle: "left",
    type: "custom",
  },
  {
    id: "e-lb-worker",
    source: "load-balancer",
    sourceHandle: "right",
    target: "worker-pool",
    targetHandle: "left",
    type: "custom",
  },
  {
    id: "e-web-db",
    source: "web-server",
    sourceHandle: "right",
    target: "postgresql",
    targetHandle: "left",
    type: "custom",
  },
  {
    id: "e-worker-db",
    source: "worker-pool",
    sourceHandle: "right",
    target: "postgresql",
    targetHandle: "left",
    type: "custom",
  },
];

let id = 1;
const getId = () => `${id++}`;
const nodeOrigin: [number, number] = [0, 0];

const FlowEditor = () => {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const nodeTypes = useMemo(() => ({ custom: CustomNode }), []);
  const edgeTypes = useMemo(
    () => ({
      custom: CustomEdge,
      default: CustomEdge,
    }),
    [],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "/" || e.code === "Slash")) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("vibe-theme");
      if (stored === "dark" || stored === "light") return stored;
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    return "light";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    localStorage.setItem("vibe-theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const { screenToFlowPosition } = useReactFlow();

  const onConnect = useCallback(
    (params: any) =>
      setEdges((eds) => addEdge({ ...params, type: "custom" }, eds)),
    [setEdges],
  );

  const onConnectEnd = useCallback(
    (event: any, connectionState: any) => {
      if (!connectionState.isValid) {
        const newId = `node-${getId()}`;
        const { clientX, clientY } =
          "changedTouches" in event ? event.changedTouches[0] : event;
        const newNode: Node = {
          id: newId,
          type: "custom",
          position: screenToFlowPosition({
            x: clientX,
            y: clientY,
          }),
          data: { label: `Service ${newId}`, sublabel: "active service" },
          origin: [0, 0],
        };

        setNodes((nds) => nds.concat(newNode));
        setEdges((eds) =>
          eds.concat({
            id: `e-${connectionState.fromNode.id}-${newId}`,
            source: connectionState.fromNode.id,
            target: newId,
            type: "custom",
          }),
        );
      }
    },
    [screenToFlowPosition, setNodes, setEdges],
  );

  return (
    <div className="wrapper w-full h-full relative" ref={reactFlowWrapper}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{ type: "custom" }}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        nodeOrigin={nodeOrigin}
        colorMode={theme}
        panOnScroll
        panOnScrollMode="free"
        zoomOnScroll={false}
        zoomActivationKeyCode="Meta"
      >
        {/*<Background
          variant={BackgroundVariant.Dots}
          gap={18}
          size={1.2}
          color={theme === "dark" ? "#333333" : "#d8d7d5"}
        />*/}

        {/* Top-Center Spotlight Search Bar */}
        <Panel position="top-center" className="!m-4 z-50">
          <div
            onClick={() => searchInputRef.current?.focus()}
            className="flex items-center gap-2 px-3 py-1.5 w-72 sm:w-80 md:w-96 rounded-[8px] bg-white dark:bg-[#202020] text-black dark:text-white border border-[#e6e6e6] dark:border-[#2f2f2f] hover:border-[#0075de]/40 dark:hover:border-[#0075de]/40 focus-within:border-[#0075de] dark:focus-within:border-[#0075de] focus-within:hover:border-[#0075de] dark:focus-within:hover:border-[#0075de] focus-within:ring-1 focus-within:ring-[#0075de] dark:focus-within:ring-[#0075de] transition-colors shadow-[0px_0.175px_1.041px_0px_rgba(0,0,0,0.01),0px_0.8px_2.925px_0px_rgba(0,0,0,0.02),0px_2.025px_7.847px_0px_rgba(0,0,0,0.027)] cursor-text"
          >
            <Search className="w-3.5 h-3.5 text-neutral-400 dark:text-neutral-500 shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="What resource to add next?"
              className="flex-1 bg-transparent text-xs text-black dark:text-white placeholder:text-neutral-400 dark:placeholder:text-neutral-500 outline-none font-medium min-w-0"
            />
            <kbd className="text-[10px] font-medium text-neutral-400 dark:text-neutral-500 font-sans tracking-tight border border-neutral-200 dark:border-neutral-700/60 rounded px-1.5 py-0.5 shrink-0 select-none">
              ⌘ + /
            </kbd>
          </div>
        </Panel>

        {/* Top-Right Theme Toggle conforming to Notion Design System */}
        <Panel position="top-right" className="!m-4 z-50">
          <button
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="flex items-center gap-2 px-3 py-1.5 rounded-[8px] bg-white dark:bg-[#202020] text-black dark:text-white border border-[#e6e6e6] dark:border-[#2f2f2f] hover:bg-[#f6f5f4] dark:hover:bg-[#2a2a2a] transition-colors shadow-[0px_0.175px_1.041px_0px_rgba(0,0,0,0.01),0px_0.8px_2.925px_0px_rgba(0,0,0,0.02),0px_2.025px_7.847px_0px_rgba(0,0,0,0.027)] cursor-pointer text-xs font-medium"
          >
            {theme === "dark" ? (
              <>
                <Sun className="w-3.5 h-3.5 text-[#0075de]" />
                <span>Light</span>
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5 text-[#0075de]" />
                <span>Dark</span>
              </>
            )}
          </button>
        </Panel>
      </ReactFlow>
    </div>
  );
};

function App() {
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <div className="h-full w-[65%] min-w-0">
        <ReactFlowProvider>
          <FlowEditor />
        </ReactFlowProvider>
      </div>
      <ChatPanel />
    </div>
  );
}

export default App;
