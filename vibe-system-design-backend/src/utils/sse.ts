import type { ProtocolEvent } from './protocol-event.js';

export const SSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

export function formatEventFrame(event: ProtocolEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function formatDoneFrame(): string {
  return 'event: done\ndata: {}\n\n';
}

export function formatErrorFrame(message: string): string {
  return `event: error\ndata: ${JSON.stringify({ message })}\n\n`;
}
