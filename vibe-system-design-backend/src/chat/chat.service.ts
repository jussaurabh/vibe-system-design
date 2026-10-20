import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { HumanMessage } from '@langchain/core/messages';
import type { ProtocolEvent } from '@langchain/langgraph';

import { DEEP_AGENT, type StreamableAgent } from '../agent/agent.provider.js';
import { HARDCODED_USER_ID } from './chat.constants.js';
import { toLangChainMessages } from './chat.history.js';
import { RunRecorder } from './chat.persistence.js';
import { CHAT_REPOSITORY, type ChatRepository } from './chat.repository.js';
import { cutTitle } from './chat.title.js';
import type { SessionSummary, StoredMessage } from './chat.types.js';
import { newMessageId, newSessionId } from './id.js';
import { createEventFilter } from './stream-event-filter.js';
import { resolveEventSelectors } from './stream-event-policy.js';

@Injectable()
export class ChatService {
  private readonly isEnabled: (event: ProtocolEvent) => boolean;
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @Inject(DEEP_AGENT) private readonly agent: StreamableAgent,
    @Inject(CHAT_REPOSITORY) private readonly repository: ChatRepository,
  ) {
    this.isEnabled = createEventFilter(resolveEventSelectors());
  }

  listSessions(): Promise<SessionSummary[]> {
    return this.repository.listSessions(HARDCODED_USER_ID);
  }

  createSession(): Promise<SessionSummary> {
    return this.repository.createSession(HARDCODED_USER_ID, newSessionId(), Date.now());
  }

  async getSession(sessionId: string): Promise<SessionSummary> {
    const session = await this.repository.getSession(HARDCODED_USER_ID, sessionId);
    if (session === null) throw new NotFoundException(`The session ${sessionId} does not exist.`);
    return session;
  }

  async renameSession(sessionId: string, title: string): Promise<SessionSummary> {
    const renamed = await this.repository.renameSession(HARDCODED_USER_ID, sessionId, title);
    if (!renamed) throw new NotFoundException(`The session ${sessionId} does not exist.`);
    return this.getSession(sessionId);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.repository.deleteSession(HARDCODED_USER_ID, sessionId);
  }

  listMessages(sessionId: string): Promise<StoredMessage[]> {
    return this.repository.listMessages(sessionId);
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.repository.deleteMessage(HARDCODED_USER_ID, messageId);
  }

  /**
   * Run the agent for one new user message and stream its protocol events.
   *
   * The database is the source of truth for the history. The request carries
   * only the new message, and the service loads the rest of the conversation
   * from the repository before the agent runs.
   */
  async *stream(
    sessionId: string,
    message: string,
    signal: AbortSignal,
  ): AsyncIterable<ProtocolEvent> {
    const session = await this.repository.getSession(HARDCODED_USER_ID, sessionId);
    if (session === null) throw new NotFoundException(`The session ${sessionId} does not exist.`);

    const history = toLangChainMessages(await this.repository.listMessages(sessionId));

    // The question is stored before the agent runs. A crash keeps the question.
    try {
      await this.repository.appendMessage({
        id: newMessageId(),
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
        await this.repository.renameSession(HARDCODED_USER_ID, sessionId, cutTitle(message));
      }
    } catch (err) {
      // A write failure never breaks the stream.
      this.logger.error(`The user message of session ${sessionId} was not stored.`, err);
    }

    history.push(new HumanMessage(message));

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
            this.logger.error(`A chat message of session ${sessionId} was not stored.`, err);
          }
        });
      },
    });

    const events = await this.agent.streamEvents(
      { messages: history },
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
