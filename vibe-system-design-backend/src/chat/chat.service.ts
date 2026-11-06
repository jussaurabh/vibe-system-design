import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Client, Thread } from '@langchain/langgraph-sdk';

import { AGENT_SERVER_CLIENT } from '../agent-server/agent-server.module.js';
import { ASSISTANT_ID } from './chat.constants.js';
import { ProtocolAdapter, type AgentServerChunk } from './protocol-adapter.js';
import { cutTitle } from '../utils/cut-title.js';
import type {
  SessionSummary,
  StoredMessage,
  MessageStatus,
} from './chat.types.js';
import type { ProtocolEvent } from '../utils/protocol-event.js';
import { AppLogger } from '../logging/app-logger.js';
import { Timed } from '../logging/utils/timed.js';
import {
  CHAT_MESSAGES_REPOSITORY,
  type ChatMessagesRepository,
  toStoredMessage,
} from './chat-messages.repository.js';
import { AssistantRecorder } from './assistant-recorder.js';

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

@Injectable()
export class ChatService {
  private readonly logger = new AppLogger(ChatService.name);
  private readonly activeSessions = new Set<string>();
  private readonly stopRequested = new Set<string>();

  constructor(
    @Inject(AGENT_SERVER_CLIENT) private readonly client: Client,
    @Inject(CHAT_MESSAGES_REPOSITORY)
    private readonly messages: ChatMessagesRepository,
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
  async renameSession(
    sessionId: string,
    title: string,
  ): Promise<SessionSummary> {
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
      await this.messages.deleteByThread(sessionId);
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
      await this.client.threads.get(sessionId);
      const rows = await this.messages.listByThread(sessionId);
      const messages = rows.map(toStoredMessage);

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
   * Interrupt the pending and running runs of a session.
   *
   * The UI knows only the session, and the Agent Server refuses a cancel that
   * mixes `status` with `thread_id`. This code lists the runs of the thread,
   * keeps the active ones, and interrupts each by id. The `interrupt` action
   * stops the run and keeps its checkpoints, so the thread state stays
   * readable.
   */
  @Timed({ metaData: (args) => ({ sessionId: args[0] }) })
  async stopSession(sessionId: string): Promise<void> {
    try {
      if (this.activeSessions.has(sessionId)) {
        this.stopRequested.add(sessionId);
      }

      const runs = await this.client.runs.list(sessionId, { limit: 100 });
      const active = runs.filter(
        (run) => run.status === 'pending' || run.status === 'running',
      );
      await Promise.all(
        active.map(async (run) => {
          try {
            await this.client.runs.cancel(
              sessionId,
              run.run_id,
              true,
              'interrupt',
            );
          } catch (err) {
            // The run finished between the list and the cancel. That run is
            // already stopped, so the stop stays idempotent.
            if (!isNotFound(err)) throw err;
          }
        }),
      );
      this.logger.info('Stopped chat session successfully', {
        sessionId,
        runs: active.length,
      });
    } catch (err) {
      // A missing thread is the same 404 the repository answered before.
      if (isNotFound(err)) {
        throw new NotFoundException(`The session ${sessionId} does not exist.`);
      }
      this.logger.error(`Failed to stop chat session ${sessionId}`, err);
      throw err;
    }
  }

  async beginTurn(sessionId: string, message: string): Promise<void> {
    await this.messages.appendUser(sessionId, message);
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
    const recorder = new AssistantRecorder();
    const adapter = new ProtocolAdapter();
    const startedAt = performance.now();
    let status: MessageStatus = 'complete';
    let completed = false;
    this.activeSessions.add(sessionId);

    try {
      const chunks = this.client.runs.stream(sessionId, ASSISTANT_ID, {
        input: {
          messages: [
            {
              role: 'user',
              content: `<user_prompt>\n${message}\n</user_prompt>`,
            },
          ],
        },
        streamMode: ['messages-tuple', 'updates'],
      });
      for await (const chunk of chunks as AsyncIterable<AgentServerChunk>) {
        recorder.consume(chunk);
        for (const event of adapter.consume(chunk)) yield event;
      }
      this.logger.debug('All chunks consumed by recorder', { sessionId });
      completed = true;
      for (const event of adapter.flush()) yield event;
    } catch (err) {
      status = 'error';
      throw err;
    } finally {
      this.activeSessions.delete(sessionId);
      if (this.stopRequested.delete(sessionId)) {
        status = 'incomplete';
      } else if (!completed && status !== 'error') {
        status = 'incomplete';
      }

      const latencyMs = Math.round(performance.now() - startedAt);
      try {
        const recorded = recorder.finish(status);
        await this.messages.appendAssistant({
          threadId: sessionId,
          langgraphId: recorded.langgraphId,
          status,
          parts: recorded.parts,
          modelName: recorded.modelName,
          inputTokens: recorded.inputTokens,
          outputTokens: recorded.outputTokens,
          reasoningTokens: recorded.reasoningTokens,
          latencyMs,
          runId: recorded.runId,
        });
        this.logger.debug('Assistant message stored', {
          sessionId,
          langgraphId: recorded.langgraphId,
          status,
          partsCount: recorded.parts.length,
          inputTokens: recorded.inputTokens,
          outputTokens: recorded.outputTokens,
          reasoningTokens: recorded.reasoningTokens,
          latencyMs,
          runId: recorded.runId,
        });
      } catch (err) {
        this.logger.error(
          `Failed to store the assistant message of session ${sessionId}`,
          err,
        );
      }
    }
  }
}
