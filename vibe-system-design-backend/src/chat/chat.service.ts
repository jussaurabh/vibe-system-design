import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { HumanMessage } from '@langchain/core/messages';
import type { ProtocolEvent } from '@langchain/langgraph';
import type { Client, Thread } from '@langchain/langgraph-sdk';

import { AGENT_SERVER_CLIENT } from '../agent-server/agent-server.module.js';
import { DEEP_AGENT, type StreamableAgent } from '../agent/agent.provider.js';
import { HARDCODED_USER_ID } from './chat.constants.js';
import { toLangChainMessages } from './utils/history.js';
import { RunRecorder } from './chat.persistence.js';
import { CHAT_REPOSITORY, type ChatRepository } from './chat.repository.js';
import { cutTitle } from '../utils/cut-title.js';
import type { SessionSummary, StoredMessage } from './chat.types.js';
import { newMessageId } from './utils/id.js';
import { createEventFilter } from '../utils/stream-event-filter.js';
import { resolveEventSelectors } from '../utils/stream-event-policy.js';
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

@Injectable()
export class ChatService {
  private readonly isEnabled: (event: ProtocolEvent) => boolean;
  private readonly logger = new AppLogger(ChatService.name);

  constructor(
    @Inject(DEEP_AGENT) private readonly agent: StreamableAgent,
    @Inject(CHAT_REPOSITORY) private readonly repository: ChatRepository,
    @Inject(AGENT_SERVER_CLIENT) private readonly client: Client,
  ) {
    this.isEnabled = createEventFilter(resolveEventSelectors());
  }

  @Timed({ metaData: () => ({ userId: HARDCODED_USER_ID }) })
  async listSessions(): Promise<SessionSummary[]> {
    try {
      const threads = await this.client.threads.search({ limit: 100 });
      // The client sorts. This avoids a dependency on the search order the
      // server happens to answer with.
      const sessions = threads
        .map(toSessionSummary)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      this.logger.info('Listed chat sessions successfully', {
        userId: HARDCODED_USER_ID,
        count: sessions.length,
      });
      return sessions;
    } catch (err) {
      this.logger.error('Failed to list chat sessions', err);
      throw err;
    }
  }

  @Timed({ metaData: () => ({ userId: HARDCODED_USER_ID }) })
  async createSession(): Promise<SessionSummary> {
    try {
      const thread = await this.client.threads.create({
        metadata: { title: '' },
      });
      // Transitional: the chat_messages foreign key needs the session row
      // until Task 4 stops the message writes.
      await this.repository.createSession(
        HARDCODED_USER_ID,
        thread.thread_id,
        Date.now(),
      );
      this.logger.info('Created chat session successfully', {
        userId: HARDCODED_USER_ID,
        sessionId: thread.thread_id,
      });
      return toSessionSummary(thread);
    } catch (err) {
      this.logger.error('Failed to create chat session', err);
      throw err;
    }
  }

  @Timed({ metaData: (args) => ({ sessionId: args[0], userId: HARDCODED_USER_ID }) })
  async getSession(sessionId: string): Promise<SessionSummary> {
    try {
      const thread = await this.client.threads.get(sessionId);
      this.logger.info('Fetched chat session successfully', {
        sessionId,
        userId: HARDCODED_USER_ID,
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

  @Timed({ metaData: (args) => ({ sessionId: args[0], title: args[1], userId: HARDCODED_USER_ID }) })
  async renameSession(sessionId: string, title: string): Promise<SessionSummary> {
    try {
      const thread = await this.client.threads.get(sessionId);
      const updated = await this.client.threads.update(sessionId, {
        metadata: { ...thread.metadata, title },
      });
      this.logger.info('Renamed chat session successfully', {
        sessionId,
        title,
        userId: HARDCODED_USER_ID,
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

  @Timed({ metaData: (args) => ({ sessionId: args[0], userId: HARDCODED_USER_ID }) })
  async deleteSession(sessionId: string): Promise<void> {
    try {
      try {
        await this.client.threads.delete(sessionId);
      } catch (err) {
        // A missing thread is already gone. The delete stays idempotent,
        // the same as the repository delete answered before.
        if (!isNotFound(err)) throw err;
      }
      await this.repository.deleteSession(HARDCODED_USER_ID, sessionId);
      this.logger.info('Deleted chat session successfully', {
        sessionId,
        userId: HARDCODED_USER_ID,
      });
    } catch (err) {
      this.logger.error(`Failed to delete chat session ${sessionId}`, err);
      throw err;
    }
  }

  @Timed({ metaData: (args) => ({ sessionId: args[0] }) })
  async listMessages(sessionId: string): Promise<StoredMessage[]> {
    try {
      const result = await this.repository.listMessages(sessionId);
      this.logger.info('Listed chat messages successfully', {
        sessionId,
        count: result.length,
      });
      return result;
    } catch (err) {
      this.logger.error(`Failed to list chat messages for session ${sessionId}`, err);
      throw err;
    }
  }

  @Timed({ metaData: (args) => ({ messageId: args[0], userId: HARDCODED_USER_ID }) })
  async deleteMessage(messageId: string): Promise<void> {
    try {
      await this.repository.deleteMessage(HARDCODED_USER_ID, messageId);
      this.logger.info('Deleted chat message successfully', {
        messageId,
        userId: HARDCODED_USER_ID,
      });
    } catch (err) {
      this.logger.error(`Failed to delete chat message ${messageId}`, err);
      throw err;
    }
  }

  /**
   * Run the agent for one new user message and stream its protocol events.
   *
   * The agent input carries only the new message. The checkpointer restores
   * the rest of the conversation with the `thread_id` of the run config.
   */
  async *stream(
    sessionId: string,
    message: string,
    signal: AbortSignal,
    prefetchedSession?: SessionSummary,
  ): AsyncIterable<ProtocolEvent> {
    const session =
      prefetchedSession ??
      (await this.repository.getSession(HARDCODED_USER_ID, sessionId));
    if (session === null)
      throw new NotFoundException(`The session ${sessionId} does not exist.`);

    const userMessageId = newMessageId();

    // The question is stored before the agent runs. A crash keeps the question.
    try {
      await this.repository.appendMessage({
        id: userMessageId,
        sessionId,
        senderType: 'user',
        content: [{ type: 'text', text: message }],
        status: 'complete',
        tokenCount: null,
        modelName: null,
        latencyMs: null,
        createdAt: Date.now(),
      });
      if (session.title === '') {
        await this.repository.renameSession(
          HARDCODED_USER_ID,
          sessionId,
          cutTitle(message),
        );
      }
    } catch (err) {
      // A write failure never breaks the stream.
      this.logger.error(
        `The user message of session ${sessionId} was not stored.`,
        err,
      );
    }

    // The thread metadata owns the title from here on. The DB rename above
    // dies with the repository in Task 4.
    if (session.title === '') {
      try {
        const thread = await this.client.threads.get(sessionId);
        await this.client.threads.update(sessionId, {
          metadata: { ...thread.metadata, title: cutTitle(message) },
        });
      } catch (err) {
        // A metadata write failure never breaks the stream.
        this.logger.error(
          `The title of session ${sessionId} was not stored in the thread metadata.`,
          err,
        );
      }
    }

    this.logger.info('Sent the new user message to the agent', {
      sessionId,
      userId: HARDCODED_USER_ID,
      historySource: 'checkpoint',
      inputCount: 1,
      userMessageId,
    });

    // The rows are written one after the other. Two writes in parallel would
    // race for the next seq of the session.
    let writes: Promise<void> = Promise.resolve();
    const recorder = new RunRecorder({
      newMessageId,
      now: () => Date.now(),
      modelName: this.agent.modelName ?? null,
      onRow: (row) => {
        writes = writes.then(async () => {
          try {
            await this.repository.appendMessage({
              id: row.id,
              sessionId,
              senderType: row.senderType,
              content: row.content,
              status: row.status,
              tokenCount: row.tokenCount,
              modelName: row.modelName,
              latencyMs: row.latencyMs,
              createdAt: row.createdAt,
            });
          } catch (err) {
            // A write failure never breaks the stream.
            this.logger.error(
              `A chat message of session ${sessionId} was not stored.`,
              err,
            );
          }
        });
      },
    });

    const events = await this.agent.streamEvents(
      { messages: [new HumanMessage(message)] },
      {
        version: 'v3',
        configurable: {
          thread_id: sessionId,
          user_id: HARDCODED_USER_ID,
          session_id: sessionId,
        },
        signal,
      },
    );

    try {
      for await (const event of events) {
        recorder.handle(event);
        if (this.isEnabled(event)) yield event;
      }
    } catch (err) {
      // A run the user stopped is not a failure. The partial reply is stored
      // as incomplete.
      recorder.finish(signal.aborted ? 'incomplete' : 'error');
      throw err;
    } finally {
      // A reply that never reached its end is incomplete.
      recorder.finish('incomplete');
      await writes;
    }
  }
}
