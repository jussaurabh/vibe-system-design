import type { ProtocolEvent, UsageInfo } from '../utils/protocol-event.js';

/** One chunk of the Agent Server stream, as the SDK client yields it. */
export interface AgentServerChunk {
  readonly event: string;
  readonly data: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Extract the text that one `messages` chunk carries. */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  let text = '';
  for (const block of content) {
    if (
      isRecord(block) &&
      block['type'] === 'text' &&
      typeof block['text'] === 'string'
    ) {
      text += block['text'];
    }
  }
  return text;
}

/** Read the `usage_metadata` of one `messages` chunk. */
function readUsage(chunk: Record<string, unknown>): UsageInfo | undefined {
  return chunk['usage_metadata'] != null
    ? (chunk['usage_metadata'] as UsageInfo)
    : undefined;
}

/** Read the graph node that the chunk metadata attributes the event to. */
function readNode(metadata: unknown): string | undefined {
  if (!isRecord(metadata)) return undefined;
  const node = metadata['langgraph_node'];
  return typeof node === 'string' ? node : undefined;
}

/**
 * Translate Agent Server stream chunks into the UI frame shapes.
 *
 * The adapter holds the stream state of one run: the open assistant message,
 * its last reported token usage, and the lifecycle frames it already sent.
 * `consume` turns one chunk into zero or more `ProtocolEvent`s. `flush`
 * closes the open message and ends the run; further calls return nothing.
 */
export class ProtocolAdapter {
  private nextSeq = 0;
  private runningEmitted = false;
  private completedEmitted = false;
  private isOpen = false;
  private openMessageId: string | undefined;
  private usage: UsageInfo | undefined;

  /** Consume one Agent Server chunk and return the frames it produces. */
  consume(chunk: AgentServerChunk): ProtocolEvent[] {
    switch (chunk.event) {
      case 'metadata':
        return this.consumeMetadata();
      case 'messages':
        return this.consumeMessages(chunk.data);
      case 'updates':
        return [this.emit('updates', chunk.data)];
      default:
        return [];
    }
  }

  /**
   * Close the open message and end the run. The `completed` frame is emitted
   * exactly once across the life of the adapter; further calls return `[]`.
   */
  flush(): ProtocolEvent[] {
    if (this.completedEmitted) return [];
    const events = this.closeOpenMessage();
    this.completedEmitted = true;
    events.push(this.emit('lifecycle', { event: 'completed' }));
    return events;
  }

  private consumeMetadata(): ProtocolEvent[] {
    if (this.runningEmitted) return [];
    this.runningEmitted = true;
    return [this.emit('lifecycle', { event: 'running' })];
  }

  private consumeMessages(data: unknown): ProtocolEvent[] {
    if (!Array.isArray(data) || data.length !== 2) return [];
    const [rawChunk, rawMetadata] = data;
    const node = readNode(rawMetadata);
    const chunk = isRecord(rawChunk) ? rawChunk : {};
    const id = typeof chunk['id'] === 'string' ? chunk['id'] : undefined;
    const text = extractText(chunk['content']);

    const events: ProtocolEvent[] = [];
    if (id !== this.openMessageId || !this.isOpen) {
      events.push(...this.closeOpenMessage(node));
      events.push(...this.openMessage(id, node));
    }
    const chunkUsage = readUsage(chunk);
    if (chunkUsage !== undefined) {
      this.usage = chunkUsage;
    }
    if (text !== '') {
      events.push(
        this.emit(
          'messages',
          {
            event: 'content-block-delta',
            index: 0,
            delta: { type: 'text-delta', text },
          },
          node,
        ),
      );
    }
    return events;
  }

  private closeOpenMessage(node?: string): ProtocolEvent[] {
    if (!this.isOpen) return [];
    this.isOpen = false;
    const finishData =
      this.usage === undefined
        ? { event: 'message-finish' }
        : { event: 'message-finish', usage: this.usage };
    this.usage = undefined;
    return [
      this.emit('messages', { event: 'content-block-finish', index: 0 }, node),
      this.emit('messages', finishData, node),
    ];
  }

  private openMessage(id: string | undefined, node?: string): ProtocolEvent[] {
    this.isOpen = true;
    this.openMessageId = id;
    const startData =
      id === undefined
        ? { event: 'message-start', role: 'assistant' }
        : { event: 'message-start', role: 'assistant', id };
    return [
      this.emit('messages', startData, node),
      this.emit(
        'messages',
        {
          event: 'content-block-start',
          index: 0,
          content: { type: 'text', text: '' },
        },
        node,
      ),
    ];
  }

  private emit(method: string, data: unknown, node?: string): ProtocolEvent {
    return {
      type: 'event',
      seq: this.nextSeq++,
      method,
      params: {
        namespace: [],
        timestamp: Date.now(),
        ...(node ? { node } : {}),
        data,
      },
    };
  }
}
