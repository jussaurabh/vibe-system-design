import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages';

import type { StoredMessage } from '../chat.types.js';

function textOf(content: StoredMessage['content']): string {
  return content
    .filter(
      (part): part is { type: 'text'; text: string } => part.type === 'text',
    )
    .map((part) => part.text)
    .join('\n\n');
}

/**
 * Map the stored rows of a session back to the LangChain messages that the
 * agent replays. A tool row is a log for the reader, not part of the agent's
 * message list, so it is skipped.
 */
export function toLangChainMessages(
  rows: readonly StoredMessage[],
): BaseMessage[] {
  const messages: BaseMessage[] = [];
  for (const row of rows) {
    const text = textOf(row.content);
    switch (row.senderType) {
      case 'user':
        messages.push(new HumanMessage(text));
        break;
      case 'assistant':
        messages.push(new AIMessage(text));
        break;
      case 'system':
        messages.push(new SystemMessage(text));
        break;
      case 'tool':
        break;
    }
  }
  return messages;
}
