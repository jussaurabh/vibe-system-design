import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { HumanMessage } from '@langchain/core/messages';
import type { ProtocolEvent } from '@langchain/langgraph';

import { DEEP_AGENT, type StreamableAgent } from '../agent/agent.provider.js';
import { HARDCODED_USER_ID } from './chat.constants.js';
import { RunRecorder } from './chat.persistence.js';
import { CHAT_REPOSITORY, type ChatRepository } from './chat.repository.js';
import { cutTitle } from '../utils/cut-title.js';
import type { SessionSummary, StoredMessage } from './chat.types.js';
import { newMessageId, newSessionId } from './utils/id.js';
import { createEventFilter } from '../utils/stream-event-filter.js';
import { resolveEventSelectors } from '../utils/stream-event-policy.js';
import { AppLogger } from '../logging/app-logger.js';
import { Timed } from '../logging/utils/timed.js';

@Injectable()
export class ChatService {
  private readonly isEnabled: (event: ProtocolEvent) => boolean;
  private readonly logger = new AppLogger(ChatService.name);

  constructor(
    @Inject(DEEP_AGENT) private readonly agent: StreamableAgent,
    @Inject(CHAT_REPOSITORY) private readonly repository: ChatRepository,
  ) {
    this.isEnabled = createEventFilter(resolveEventSelectors());
  }

  @Timed({ metaData: () => ({ userId: HARDCODED_USER_ID }) })
  async listSessions(): Promise<SessionSummary[]> {
    try {
      const result = await this.repository.listSessions(HARDCODED_USER_ID);
      this.logger.info('Listed chat sessions successfully', {
        userId: HARDCODED_USER_ID,
        count: result.length,
      });
      return result;
    } catch (err) {
      this.logger.error('Failed to list chat sessions', err);
      throw err;
    }
  }

  @Timed({ metaData: () => ({ userId: HARDCODED_USER_ID }) })
  async createSession(): Promise<SessionSummary> {
    const sessionId = newSessionId();
    const createdAt = Date.now();
    try {
      const result = await this.repository.createSession(
        HARDCODED_USER_ID,
        sessionId,
        createdAt,
      );
      this.logger.info('Created chat session successfully', {
        userId: HARDCODED_USER_ID,
        sessionId,
      });
      return result;
    } catch (err) {
      this.logger.error(`Failed to create chat session ${sessionId}`, err);
      throw err;
    }
  }

  @Timed({
    metaData: (args) => ({ sessionId: args[0], userId: HARDCODED_USER_ID }),
  })
  async getSession(sessionId: string): Promise<SessionSummary> {
    try {
      const session = await this.repository.getSession(
        HARDCODED_USER_ID,
        sessionId,
      );
      if (session === null) {
        throw new NotFoundException(`The session ${sessionId} does not exist.`);
      }
      this.logger.info('Fetched chat session successfully', {
        sessionId,
        userId: HARDCODED_USER_ID,
      });
      return session;
    } catch (err) {
      this.logger.error(`Failed to fetch chat session ${sessionId}`, err);
      throw err;
    }
  }

  @Timed({
    metaData: (args) => ({
      sessionId: args[0],
      title: args[1],
      userId: HARDCODED_USER_ID,
    }),
  })
  async renameSession(
    sessionId: string,
    title: string,
  ): Promise<SessionSummary> {
    try {
      const renamed = await this.repository.renameSession(
        HARDCODED_USER_ID,
        sessionId,
        title,
      );
      if (!renamed) {
        throw new NotFoundException(`The session ${sessionId} does not exist.`);
      }
      const result = await this.getSession(sessionId);
      this.logger.info('Renamed chat session successfully', {
        sessionId,
        title,
        userId: HARDCODED_USER_ID,
      });
      return result;
    } catch (err) {
      this.logger.error(`Failed to rename chat session ${sessionId}`, err);
      throw err;
    }
  }

  @Timed({
    metaData: (args) => ({ sessionId: args[0], userId: HARDCODED_USER_ID }),
  })
  async deleteSession(sessionId: string): Promise<void> {
    try {
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
      this.logger.error(
        `Failed to list chat messages for session ${sessionId}`,
        err,
      );
      throw err;
    }
  }

  @Timed({
    metaData: (args) => ({ messageId: args[0], userId: HARDCODED_USER_ID }),
  })
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
