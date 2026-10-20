import type { ProtocolEvent } from '@langchain/langgraph';

import type { MessagePart, MessageStatus, SenderType } from '../db/schema.js';

/** One stored row, as the recorder hands it to the repository. */
export interface RecordedMessage {
  readonly id: string;
  readonly senderType: SenderType;
  readonly content: MessagePart[];
  readonly status: MessageStatus;
  readonly tokenCount: number | null;
  readonly modelName: string | null;
  readonly latencyMs: number | null;
  readonly createdAt: number;
}

export interface RunRecorderOptions {
  readonly newMessageId: () => string;
  readonly now: () => number;
  readonly modelName: string | null;
  readonly onRow: (row: RecordedMessage) => void;
}

/** The mutable shape of a row while the recorder still owns it. */
interface OpenRow {
  id: string;
  senderType: SenderType;
  content: MessagePart[];
  status: MessageStatus;
  tokenCount: number | null;
  modelName: string | null;
  latencyMs: number | null;
  createdAt: number;
}

const MESSAGE_EVENT_NAMES = new Set([
  'message-start',
  'content-block-start',
  'content-block-delta',
  'content-block-finish',
  'message-finish',
  'usage',
]);

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

/** Read the name of the event out of the payload of a protocol event. */
export function readEventName(data: Record<string, unknown> | undefined): string | undefined {
  if (data === undefined) return undefined;
  const event = data['event'];
  if (typeof event === 'string') return event;
  // Some payloads name the event in `type`. The delta types are not event
  // names, so they never reach this branch.
  const type = data['type'];
  if (typeof type === 'string' && MESSAGE_EVENT_NAMES.has(type)) return type;
  return undefined;
}

/** Report whether the payload carries a delta of any kind. */
function isDeltaPayload(data: Record<string, unknown>): boolean {
  const type = data['type'];
  return typeof type === 'string' && type.endsWith('-delta');
}

/** Read the delta object of a content block delta event. */
function readDelta(data: Record<string, unknown>): Record<string, unknown> | undefined {
  const delta = asObject(data['delta']);
  if (delta !== undefined) return delta;
  const chunk = asObject(data['chunk']);
  if (chunk !== undefined) return chunk;
  if (isDeltaPayload(data)) return data;
  return undefined;
}

/** Read the text of a text delta. */
function readDeltaText(delta: Record<string, unknown> | undefined): string | null {
  if (delta === undefined) return null;
  if (delta['type'] === 'text-delta' && typeof delta['text'] === 'string') {
    return delta['text'];
  }
  const fields = asObject(delta['fields']);
  if (fields !== undefined && fields['type'] === 'text' && typeof fields['text'] === 'string') {
    return fields['text'];
  }
  return null;
}

/** Report whether the payload of a content block start names a text block. */
function isTextBlock(data: Record<string, unknown>): boolean {
  // The protocol sends the block under `content`. The other names are the
  // candidates of an earlier draft of the protocol.
  const block =
    asObject(data['content']) ??
    asObject(data['contentBlock']) ??
    asObject(data['block']) ??
    (typeof data['type'] === 'string' ? { type: data['type'] } : undefined);
  if (block === undefined) return false;
  const type = block['type'];
  return type === 'text' || type === 'text-delta';
}

/** Read the token count of a usage event. */
export function readTokenCount(data: Record<string, unknown> | undefined): number | null {
  if (data === undefined) return null;
  const usage = asObject(data['usage']);
  const usageMetadata = asObject(data['usage_metadata']);
  const chunk = asObject(data['chunk']);
  const chunkMetadata = asObject(chunk?.['usage_metadata']);

  const candidates = [
    usage?.['total_tokens'],
    usageMetadata?.['total_tokens'],
    chunkMetadata?.['total_tokens'],
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'number') return candidate;
  }

  const input = data['input_tokens'];
  const output = data['output_tokens'];
  if (typeof input === 'number' && typeof output === 'number') return input + output;
  return null;
}

/** Read the tool call id of a tool event. */
function readToolCallId(data: Record<string, unknown>): string | undefined {
  for (const key of ['toolCallId', 'tool_call_id', 'id']) {
    const value = data[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

/** Read the name of the tool of a tool event. */
function readToolName(data: Record<string, unknown>): string | undefined {
  const name = data['name'];
  if (typeof name === 'string' && name.length > 0) return name;
  // The protocol sends the name under `tool_name`.
  const toolName = data['tool_name'];
  if (typeof toolName === 'string' && toolName.length > 0) return toolName;
  const tool = asObject(data['tool']);
  const nestedName = tool?.['name'];
  if (typeof nestedName === 'string' && nestedName.length > 0) return nestedName;
  return undefined;
}

/** Read the input of a tool event. */
function readToolInput(data: Record<string, unknown>): unknown {
  for (const key of ['input', 'args', 'arguments']) {
    if (key in data) return data[key];
  }
  return undefined;
}

/** Read the output of a finished tool event. */
function readToolOutput(data: Record<string, unknown>): unknown {
  for (const key of ['output', 'result']) {
    if (key in data) return data[key];
  }
  return undefined;
}

/**
 * The recorder turns the protocol events of one agent run into stored rows.
 *
 * The recorder holds one open assistant message and one open tool message at
 * a time. A closed row is handed to `onRow`, and the caller decides whether
 * to write it to the database.
 */
export class RunRecorder {
  private readonly options: RunRecorderOptions;
  private openAssistant: OpenRow | null = null;
  private openTool: OpenRow | null = null;
  private lastAssistant: OpenRow | null = null;

  constructor(options: RunRecorderOptions) {
    this.options = options;
  }

  handle(event: ProtocolEvent): void {
    const data = asObject(event.params.data);
    if (event.method === 'messages') {
      this.handleMessage(data);
      return;
    }
    if (event.method === 'tools') {
      this.handleTool(data);
    }
  }

  finish(status: 'incomplete' | 'error'): void {
    if (this.openAssistant !== null) {
      const row = this.openAssistant;
      this.openAssistant = null;
      row.status = status;
      row.latencyMs = this.latencyOf(row);
      this.emit(row);
    }
    if (this.openTool !== null) {
      const row = this.openTool;
      this.openTool = null;
      row.status = 'error';
      this.setToolPartStatus(row, 'error');
      this.emit(row);
    }
  }

  private handleMessage(data: Record<string, unknown> | undefined): void {
    if (data === undefined) return;
    let name = readEventName(data);
    // A delta payload can arrive without an event name. Treat it as a
    // content block delta, so the text of the reply is never lost.
    if (name === undefined && isDeltaPayload(data)) name = 'content-block-delta';
    if (name === undefined) return;

    switch (name) {
      case 'message-start':
        this.openAssistant = this.newAssistantRow();
        break;
      case 'content-block-start':
        if (this.openAssistant !== null && isTextBlock(data)) {
          this.openAssistant.content.push({ type: 'text', text: '' });
        }
        break;
      case 'content-block-delta': {
        if (this.openAssistant === null) break;
        const text = readDeltaText(readDelta(data));
        if (text === null) break;
        this.appendText(this.openAssistant, text);
        break;
      }
      case 'content-block-finish':
        break;
      case 'message-finish': {
        const row = this.openAssistant;
        if (row === null) break;
        this.openAssistant = null;
        row.status = 'complete';
        row.latencyMs = this.latencyOf(row);
        // The usage of the run can arrive inside the finish payload.
        row.tokenCount = readTokenCount(data) ?? row.tokenCount;
        this.lastAssistant = row;
        this.emit(row);
        break;
      }
      case 'usage': {
        const tokenCount = readTokenCount(data);
        if (tokenCount === null) break;
        const row = this.openAssistant ?? this.lastAssistant;
        if (row === null) break;
        row.tokenCount = tokenCount;
        break;
      }
      default:
        break;
    }
  }

  private handleTool(data: Record<string, unknown> | undefined): void {
    if (data === undefined) return;
    const name = readEventName(data);
    if (name === undefined) return;

    switch (name) {
      case 'tool-started': {
        const toolCallId = readToolCallId(data);
        const toolName = readToolName(data);
        const input = readToolInput(data);
        // A tool event that carries none of the candidate fields is skipped.
        // No half empty row is written.
        if (toolCallId === undefined && toolName === undefined && input === undefined) break;
        const row: OpenRow = {
          id: this.options.newMessageId(),
          senderType: 'tool',
          content: [
            {
              type: 'tool',
              toolCallId: toolCallId ?? '',
              name: toolName ?? '',
              input,
              status: 'incomplete',
            },
          ],
          status: 'incomplete',
          tokenCount: null,
          modelName: null,
          latencyMs: null,
          createdAt: this.options.now(),
        };
        this.openTool = row;
        break;
      }
      case 'tool-finished': {
        const row = this.openTool;
        if (row === null) break;
        this.openTool = null;
        const part = row.content[0];
        if (part !== undefined && part.type === 'tool') {
          part.output = readToolOutput(data);
          part.status = 'complete';
        }
        row.status = 'complete';
        this.emit(row);
        break;
      }
      case 'tool-error': {
        const row = this.openTool;
        if (row === null) break;
        this.openTool = null;
        const part = row.content[0];
        if (part !== undefined && part.type === 'tool') {
          const message = data['message'] ?? data['error'];
          part.output = typeof message === 'string' ? message : readToolOutput(data);
          part.status = 'error';
        }
        row.status = 'error';
        this.emit(row);
        break;
      }
      default:
        break;
    }
  }

  private newAssistantRow(): OpenRow {
    return {
      id: this.options.newMessageId(),
      senderType: 'assistant',
      content: [],
      status: 'incomplete',
      tokenCount: null,
      modelName: this.options.modelName,
      latencyMs: null,
      createdAt: this.options.now(),
    };
  }

  private appendText(row: OpenRow, text: string): void {
    const last = row.content[row.content.length - 1];
    if (last !== undefined && last.type === 'text') {
      last.text += text;
      return;
    }
    row.content.push({ type: 'text', text });
  }

  private setToolPartStatus(row: OpenRow, status: MessageStatus): void {
    const part = row.content[0];
    if (part !== undefined && part.type === 'tool') part.status = status;
  }

  private latencyOf(row: OpenRow): number {
    const latency = this.options.now() - row.createdAt;
    return latency > 0 ? latency : 0;
  }

  private emit(row: OpenRow): void {
    this.options.onRow(row as RecordedMessage);
  }
}
