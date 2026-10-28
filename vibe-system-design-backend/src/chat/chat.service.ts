import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Client, Thread } from '@langchain/langgraph-sdk';

import { AGENT_SERVER_CLIENT } from '../agent-server/agent-server.module.js';
import {
  AGENT_SERVER_CONFIG,
  type AgentServerConfig,
} from '../agent-server/agent-server.config.js';
import { ASSISTANT_ID } from './chat.constants.js';
import { ProtocolAdapter, type AgentServerChunk } from './protocol-adapter.js';
import { cutTitle } from '../utils/cut-title.js';
import type { SessionSummary, StoredMessage } from './chat.types.js';
import type { ProtocolEvent } from '../utils/protocol-event.js';
import { AppLogger } from '../logging/app-logger.js';
import { Timed } from '../logging/utils/timed.js';

/** The Agent Server answers a missing thread with an HTTP 404 error. */
function isNotFound(err: unknown): boolean {
  return (err as { status?: unknown } | null)?.status === 404;
}

/**
 * Parse a thread datetime into epoch milliseconds.
 *
 * The Agent Server sends ISO datetimes. A value the runtime cannot parse
 * becomes the current time instead of `NaN`.
 */
function toEpochMs(value: string | null | undefined): number {
  if (value === undefined || value === null) return Date.now();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

/** Map an Agent Server thread to the session summary the API returns. */
export function toSessionSummary(thread: Thread): SessionSummary {
  const updatedAt = toEpochMs(thread.updated_at ?? thread.created_at);
  return {
    id: thread.thread_id,
    title:
      typeof thread.metadata?.title === 'string' ? thread.metadata.title : '',
    createdAt: toEpochMs(thread.created_at),
    updatedAt,
    lastMessageAt: updatedAt,
  };
}

/** Extract the text of one state message, the same rule the adapter uses. */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  let text = '';
  for (const block of content) {
    if (
      typeof block === 'object' &&
      block !== null &&
      (block as Record<string, unknown>)['type'] === 'text' &&
      typeof (block as Record<string, unknown>)['text'] === 'string'
    ) {
      text += (block as Record<string, unknown>)['text'] as string;
    }
  }
  return text;
}

@Injectable()
export class ChatService {
  private readonly logger = new AppLogger(ChatService.name);

  constructor(
    @Inject(AGENT_SERVER_CLIENT) private readonly client: Client,
    @Inject(AGENT_SERVER_CONFIG) private readonly config: AgentServerConfig,
  ) {}

  @Timed()
  async listSessions(): Promise<SessionSummary[]> {
    try {
      const threads = await this.client.threads.search({ limit: 100 });
      // The client sorts. This avoids a dependency on the search order the
      // server happens to answer with.
      const sessions = threads
        .map(toSessionSummary)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      this.logger.info('Listed chat sessions successfully', {
        count: sessions.length,
      });
      return sessions;
    } catch (err) {
      this.logger.error('Failed to list chat sessions', err);
      throw err;
    }
  }

  @Timed()
  async createSession(): Promise<SessionSummary> {
    try {
      const thread = await this.client.threads.create({
        metadata: { title: '' },
      });
      this.logger.info('Created chat session successfully', {
        sessionId: thread.thread_id,
      });
      return toSessionSummary(thread);
    } catch (err) {
      this.logger.error('Failed to create chat session', err);
      throw err;
    }
  }

  @Timed({ metaData: (args) => ({ sessionId: args[0] }) })
  async getSession(sessionId: string): Promise<SessionSummary> {
    try {
      const thread = await this.client.threads.get(sessionId);
      this.logger.info('Fetched chat session successfully', {
        sessionId,
      });
      return toSessionSummary(thread);
    } catch (err) {
      // A missing thread is the same 404 the repository answered before.
      if (isNotFound(err)) {
        throw new NotFoundException(`The session ${sessionId} does not exist.`);
      }
      this.logger.error(`Failed to fetch chat session ${sessionId}`, err);
      throw err;
    }
  }

  @Timed({
    metaData: (args) => ({ sessionId: args[0], title: args[1] }),
  })
  async renameSession(sessionId: string, title: string): Promise<SessionSummary> {
    try {
      const thread = await this.client.threads.get(sessionId);
      const updated = await this.client.threads.update(sessionId, {
        metadata: { ...thread.metadata, title },
      });
      this.logger.info('Renamed chat session successfully', {
        sessionId,
        title,
      });
      return toSessionSummary(updated);
    } catch (err) {
      // A missing thread is the same 404 the repository answered before.
      if (isNotFound(err)) {
        throw new NotFoundException(`The session ${sessionId} does not exist.`);
      }
      this.logger.error(`Failed to rename chat session ${sessionId}`, err);
      throw err;
    }
  }

  @Timed({ metaData: (args) => ({ sessionId: args[0] }) })
  async deleteSession(sessionId: string): Promise<void> {
    try {
      try {
        await this.client.threads.delete(sessionId);
      } catch (err) {
        // A missing thread is already gone. The delete stays idempotent,
        // the same as the repository delete answered before.
        if (!isNotFound(err)) throw err;
      }
      this.logger.info('Deleted chat session successfully', {
        sessionId,
      });
    } catch (err) {
      this.logger.error(`Failed to delete chat session ${sessionId}`, err);
      throw err;
    }
  }

  @Timed({ metaData: (args) => ({ sessionId: args[0] }) })
  async listMessages(sessionId: string): Promise<StoredMessage[]> {
    try {
      const state = await this.client.threads.getState(sessionId);
      const values = state as { values?: { messages?: unknown } };
      const raw = Array.isArray(values.values?.messages)
        ? (values.values?.messages as unknown[])
        : [];

      const messages: StoredMessage[] = [];
      for (let index = 0; index < raw.length; index += 1) {
        const message = raw[index] as Record<string, unknown>;
        const type = message['type'];
        if (type !== 'human' && type !== 'ai') continue;
        const id =
          typeof message['id'] === 'string' && message['id'] !== ''
            ? message['id']
            : `${sessionId}-m${index}`;
        messages.push({
          id,
          sessionId,
          // The thread state carries no per message timestamps. The UI
          // ignores the field.
          createdAt: Date.now(),
          seq: messages.length,
          senderType: type === 'human' ? 'user' : 'assistant',
          content: [{ type: 'text', text: extractText(message['content']) }],
          status: 'complete',
          tokenCount: null,
          modelName: null,
          latencyMs: null,
        });
      }

      this.logger.info('Listed chat messages successfully', {
        sessionId,
        count: messages.length,
      });
      return messages;
    } catch (err) {
      // A missing thread is the same 404 the repository answered before.
      if (isNotFound(err)) {
        throw new NotFoundException(`The session ${sessionId} does not exist.`);
      }
      this.logger.error(
        `Failed to list chat messages for session ${sessionId}`,
        err,
      );
      throw err;
    }
  }

  /**
   * Store the title of a fresh session in the thread metadata.
   *
   * The controller calls this once per stream, before the run starts. A
   * named session keeps its title.
   */
  async ensureTitle(sessionId: string, message: string): Promise<void> {
    const thread = await this.client.threads.get(sessionId);
    const title =
      typeof thread.metadata?.title === 'string' ? thread.metadata.title : '';
    if (title !== '') return;
    await this.client.threads.update(sessionId, {
      metadata: { ...thread.metadata, title: cutTitle(message) },
    });
  }

  /**
   * Cancel the pending runs of a session.
   *
   * The SDK `cancel` needs a run id, but the UI knows only the session. The
   * raw endpoint cancels every run of the thread with one request.
   */
  async stopSession(sessionId: string): Promise<void> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.apiKey !== undefined) {
      headers['x-api-key'] = this.config.apiKey;
    }
    const response = await fetch(
      `${this.config.apiUrl}/threads/${sessionId}/runs/cancel`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'interrupt' }),
      },
    );
    if (response.status === 404) {
      throw new NotFoundException(`The session ${sessionId} does not exist.`);
    }
    if (!response.ok) {
      throw new Error(
        `The Agent Server cancel failed with status ${response.status}.`,
      );
    }
  }

  /**
   * Run the agent for one new user message and stream its protocol events.
   *
   * The Agent Server owns the history through the thread checkpoint. The run
   * carries only the new message. An upstream error propagates to the
   * controller, which turns it into an error frame.
   */
  async *stream(
    sessionId: string,
    message: string,
  ): AsyncIterable<ProtocolEvent> {
    const adapter = new ProtocolAdapter();
    const chunks = this.client.runs.stream(sessionId, ASSISTANT_ID, {
      input: { messages: [{ role: 'user', content: message }] },
      streamMode: ['messages-tuple', 'updates'],
    });
    for await (const chunk of chunks as AsyncIterable<AgentServerChunk>) {
      for (const event of adapter.consume(chunk)) yield event;
    }
    for (const event of adapter.flush()) yield event;
  }
}
