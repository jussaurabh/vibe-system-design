import React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  Server,
  Database,
  Cpu,
  Layers,
  HardDrive,
  Globe,
  Radio,
  Box,
} from "lucide-react";

export type CustomNodeData = {
  label: string;
  sublabel?: string;
};

// Pick a contextual icon based on label/type
function getNodeIcon(name: string = "") {
  const lower = name.toLowerCase();
  if (
    lower.includes("db") ||
    lower.includes("postgres") ||
    lower.includes("sql") ||
    lower.includes("data")
  ) {
    return <Database className="w-3.5 h-3.5 text-[#0075de]" />;
  }
  if (
    lower.includes("server") ||
    lower.includes("web") ||
    lower.includes("api")
  ) {
    return <Server className="w-3.5 h-3.5 text-[#0075de]" />;
  }
  if (
    lower.includes("worker") ||
    lower.includes("cpu") ||
    lower.includes("job")
  ) {
    return <Cpu className="w-3.5 h-3.5 text-[#0075de]" />;
  }
  if (
    lower.includes("load") ||
    lower.includes("balancer") ||
    lower.includes("proxy") ||
    lower.includes("route")
  ) {
    return <Layers className="w-3.5 h-3.5 text-[#0075de]" />;
  }
  if (
    lower.includes("cache") ||
    lower.includes("redis") ||
    lower.includes("mem")
  ) {
    return <HardDrive className="w-3.5 h-3.5 text-[#0075de]" />;
  }
  if (
    lower.includes("client") ||
    lower.includes("app") ||
    lower.includes("ui") ||
    lower.includes("web")
  ) {
    return <Globe className="w-3.5 h-3.5 text-[#0075de]" />;
  }
  if (
    lower.includes("queue") ||
    lower.includes("kafka") ||
    lower.includes("stream")
  ) {
    return <Radio className="w-3.5 h-3.5 text-[#0075de]" />;
  }
  return <Box className="w-3.5 h-3.5 text-[#0075de]" />;
}

export function CustomNode({ data, selected }: NodeProps<any>) {
  const label = data?.label || "Node";
  const sublabel = data?.sublabel || "active service";

  return (
    <div
      className={`group relative flex items-center gap-[10px] w-[168px] h-[68px] px-[12px] py-[10px] rounded-[10px] transition-[border-color,box-shadow,background-color] select-none box-border ${
        selected
          ? "border-[2px] border-[#0075DE] bg-white dark:bg-[#202020] shadow-[0px_0.8px_2.925px_0px_rgba(0,0,0,0.05),0px_2.025px_7.847px_0px_rgba(0,0,0,0.07),0px_4px_18px_0px_rgba(0,0,0,0.1)] dark:shadow-[0px_4px_20px_0px_rgba(0,0,0,0.5)]"
          : "border border-black/10 dark:border-white/10 bg-white dark:bg-[#202020] shadow-[0px_0.175px_1.041px_0px_rgba(0,0,0,0.01),0px_0.8px_2.925px_0px_rgba(0,0,0,0.02),0px_2.025px_7.847px_0px_rgba(0,0,0,0.027),0px_4px_18px_0px_rgba(0,0,0,0.04)] dark:shadow-[0px_4px_20px_0px_rgba(0,0,0,0.35)] hover:border-black/20 dark:hover:border-white/20"
      }`}
    >
      {/* Handles */}
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        className="!w-[7px] !h-[7px] !bg-white dark:!bg-[#202020] !border-[1.5px] !border-[#0075DE] opacity-0 group-hover:opacity-100 transition-opacity"
      />
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        className="!w-[7px] !h-[7px] !bg-white dark:!bg-[#202020] !border-[1.5px] !border-[#0075DE] opacity-0 group-hover:opacity-100 transition-opacity"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        className="!w-[7px] !h-[7px] !bg-white dark:!bg-[#202020] !border-[1.5px] !border-[#0075DE] opacity-0 group-hover:opacity-100 transition-opacity"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        className="!w-[7px] !h-[7px] !bg-white dark:!bg-[#202020] !border-[1.5px] !border-[#0075DE] opacity-0 group-hover:opacity-100 transition-opacity"
      />

      {/* Icon Frame */}
      <div className="flex items-center justify-center shrink-0 w-[28px] h-[28px] rounded-[7px] bg-[#E6F3FE] dark:bg-[#0075DE]/20">
        {getNodeIcon(label)}
      </div>

      {/* Text Area */}
      <div className="flex flex-col min-w-0 flex-1 overflow-hidden leading-tight text-left">
        <span className="text-[12.5px] font-semibold text-black dark:text-white truncate">
          {label}
        </span>
        <span className="text-[10.5px] font-normal text-[#A39E98] truncate">
          {sublabel}
        </span>
      </div>
    </div>
  );
}

export default CustomNode;
