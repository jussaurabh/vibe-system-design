import type { MessagePart, MessageStatus } from './chat.types.js';
import { AppLogger } from '../logging/app-logger.js';

export interface RecordedAssistant {
  readonly langgraphId: string | null;
  readonly runId: string | null;
  readonly modelName: string | null;
  readonly parts: MessagePart[];
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly reasoningTokens: number | null;
}

interface UsageRecord {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  hasUsage: boolean;
}

interface AiMessageChunk {
  type: 'ai';
  id?: string;
  response_metadata?: { model_name?: string };
  usage_metadata?: {
    input_tokens?: number;
    output_tokens?: number;
    output_token_details?: { reasoning?: number };
  };
  content?: string | Array<{ type?: string; text?: string; reasoning?: string }>;
  tool_calls?: Array<{ id?: string; name?: string; args?: unknown; index?: number }>;
}

interface ToolMessageChunk {
  type: 'tool';
  tool_call_id?: string;
  id?: string;
  content?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAiMessage(msg: Record<string, unknown>): msg is Record<string, unknown> & AiMessageChunk {
  return msg.type === 'ai' || msg.type === 'AIMessageChunk';
}

function isToolMessage(msg: Record<string, unknown>): msg is Record<string, unknown> & ToolMessageChunk {
  return msg.type === 'tool';
}

export class AssistantRecorder {
  private readonly logger = new AppLogger(AssistantRecorder.name);
  private runId: string | null = null;
  private langgraphId: string | null = null;
  private modelName: string | null = null;
  private textBuffer = '';
  private reasoningBuffer = '';
  private toolCalls = new Map<
    string,
    {
      toolCallId: string;
      name: string;
      argsText: string;
      index?: number;
    }
  >();
  private toolResults = new Map<string, unknown>();
  private usageMap = new Map<string, UsageRecord>();

  consume(chunk: any): void {
    if (!chunk || typeof chunk !== 'object') return;

    this.logger.debug('[AssistantRecorder] consume', { event: chunk.event, hasData: !!chunk.data });

    if (chunk.event === 'metadata' && isRecord(chunk.data) && typeof chunk.data.run_id === 'string') {
      this.runId = chunk.data.run_id;
      this.logger.debug('[AssistantRecorder] metadata', { runId: this.runId });
      return;
    }

    if (chunk.event === 'messages' && Array.isArray(chunk.data) && chunk.data.length === 2) {
      const [rawChunk, _rawMetadata] = chunk.data;
      const msg = isRecord(rawChunk) ? rawChunk : {};
      if (!msg) return;

      this.logger.debug('[AssistantRecorder] messages chunk', { type: msg.type, id: msg.id, hasContent: !!msg.content, contentType: typeof msg.content });

      const id = typeof msg.id === 'string' ? msg.id : null;
      if (id) {
        this.langgraphId = id;
      }

      if (isToolMessage(msg)) {
        const toolCallId =
          typeof msg.tool_call_id === 'string'
            ? msg.tool_call_id
            : String(msg.id ?? '');
        if (toolCallId) {
          this.toolResults.set(toolCallId, msg.content);
        }
        return;
      }

      if (!isAiMessage(msg)) return;

      // Extract model name if present
      const modelName = msg.response_metadata?.model_name;
      if (typeof modelName === 'string') {
        this.modelName = modelName;
      }

      // Extract usage metadata keyed by message id
      const usage = msg.usage_metadata;
      if (usage && typeof usage === 'object' && id) {
        const inputTokens =
          typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined;
        const outputTokens =
          typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined;
        const details = usage.output_token_details;
        const reasoningTokens =
          details && typeof details === 'object' && typeof details.reasoning === 'number'
            ? details.reasoning
            : 0;

        this.usageMap.set(id, {
          inputTokens,
          outputTokens,
          reasoningTokens,
          hasUsage: true,
        });
      }

      // Extract content blocks or text string
      const content = msg.content;
      this.logger.debug('[AssistantRecorder] content', { contentType: typeof content, isArray: Array.isArray(content), contentValue: content });
      if (typeof content === 'string') {
        this.textBuffer += content;
        this.logger.debug('[AssistantRecorder] added text string', { textBuffer: this.textBuffer, addedLength: content.length });
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (!block || typeof block !== 'object') continue;
          if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') {
            this.textBuffer += block.text;
            this.logger.debug('[AssistantRecorder] added text block', { text: block.text, textBuffer: this.textBuffer });
          } else if (
            isRecord(block) &&
            (block.type === 'reasoning' ||
              typeof block.reasoning === 'string' ||
              typeof block.text === 'string')
          ) {
            const rText = block.reasoning ?? block.text;
            if (typeof rText === 'string') {
              this.reasoningBuffer += rText;
              this.logger.debug('[AssistantRecorder] added reasoning block', { reasoning: rText, reasoningBuffer: this.reasoningBuffer });
            }
          }
        }
      }

      // Extract tool calls
      const toolCalls = msg.tool_calls;
      if (Array.isArray(toolCalls)) {
        for (const tc of toolCalls) {
          if (!tc || typeof tc !== 'object') continue;
          const toolCallId =
            typeof tc.id === 'string' ? tc.id : String(tc.args ?? '');
          const name = typeof tc.name === 'string' ? tc.name : 'tool';
          const args = tc.args;
          const index = typeof tc.index === 'number' ? tc.index : undefined;

          let existing = this.toolCalls.get(toolCallId);
          if (!existing) {
            existing = { toolCallId, name, argsText: '', index };
            this.toolCalls.set(toolCallId, existing);
          }
          if (typeof args === 'string') {
            existing.argsText += args;
          } else if (args && typeof args === 'object') {
            existing.argsText = JSON.stringify(args);
          }
          if (index !== undefined) {
            existing.index = index;
          }
        }
      }
    }
  }

  finish(status: MessageStatus): RecordedAssistant {
    const parts: MessagePart[] = [];

    if (this.reasoningBuffer.trim().length > 0) {
      parts.push({ type: 'reasoning', text: this.reasoningBuffer });
    }

    if (this.textBuffer.length > 0) {
      parts.push({ type: 'text', text: this.textBuffer });
    }

    const sortedToolCalls = Array.from(this.toolCalls.values()).sort(
      (a, b) => (a.index ?? 0) - (b.index ?? 0),
    );

    for (const tc of sortedToolCalls) {
      let parsedInput: unknown = undefined;
      if (tc.argsText.trim().length > 0) {
        try {
          parsedInput = JSON.parse(tc.argsText);
        } catch {
          parsedInput = tc.argsText;
        }
      }

      const hasResult = this.toolResults.has(tc.toolCallId);
      const toolStatus: MessageStatus = hasResult ? 'complete' : 'incomplete';
      const output = this.toolResults.get(tc.toolCallId);

      parts.push({
        type: 'tool',
        toolCallId: tc.toolCallId || 'call',
        name: tc.name,
        input: parsedInput,
        output,
        status: toolStatus,
      });
    }

    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    let reasoningTokens: number | null = null;

    if (this.usageMap.size > 0) {
      inputTokens = 0;
      outputTokens = 0;
      reasoningTokens = 0;

      for (const usage of this.usageMap.values()) {
        if (usage.inputTokens !== undefined) {
          inputTokens += usage.inputTokens;
        }
        if (usage.outputTokens !== undefined) {
          outputTokens += usage.outputTokens;
        }
        if (usage.reasoningTokens !== undefined) {
          reasoningTokens += usage.reasoningTokens;
        }
      }
    }

    this.logger.debug('[AssistantRecorder] finish', {
      langgraphId: this.langgraphId,
      runId: this.runId,
      modelName: this.modelName,
      textBufferLength: this.textBuffer.length,
      reasoningBufferLength: this.reasoningBuffer.length,
      toolCallsCount: this.toolCalls.size,
      partsCount: parts.length,
      inputTokens,
      outputTokens,
      reasoningTokens,
    });

    return {
      langgraphId: this.langgraphId,
      runId: this.runId,
      modelName: this.modelName,
      parts,
      inputTokens,
      outputTokens,
      reasoningTokens,
    };
  }
}