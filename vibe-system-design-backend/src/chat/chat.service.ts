import { Inject, Injectable } from '@nestjs/common';
import type { BaseMessage } from '@langchain/core/messages';
import type { ProtocolEvent } from '@langchain/langgraph';

import { DEEP_AGENT, type StreamableAgent } from '../agent/agent.provider.js';
import { HARDCODED_SESSION_ID, HARDCODED_THREAD_ID, HARDCODED_USER_ID } from './chat.constants.js';
import { createEventFilter } from './stream-event-filter.js';
import { resolveEventSelectors } from './stream-event-policy.js';

@Injectable()
export class ChatService {
  private readonly isEnabled: (event: ProtocolEvent) => boolean;

  constructor(@Inject(DEEP_AGENT) private readonly agent: StreamableAgent) {
    this.isEnabled = createEventFilter(resolveEventSelectors());
  }

  async *stream(messages: BaseMessage[], signal: AbortSignal): AsyncIterable<ProtocolEvent> {
    const events = await this.agent.streamEvents(
      { messages },
      {
        version: 'v3',
        configurable: {
          thread_id: HARDCODED_THREAD_ID,
          user_id: HARDCODED_USER_ID,
          session_id: HARDCODED_SESSION_ID,
        },
        signal,
      },
    );
    for await (const event of events) {
      if (this.isEnabled(event)) yield event;
    }
  }
}
