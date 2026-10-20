import { z } from 'zod';
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';

export const chatStreamRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string().min(1),
      }),
    )
    .min(1),
});

export type ChatStreamRequestDto = z.infer<typeof chatStreamRequestSchema>;

export function toLangChainMessages(messages: ChatStreamRequestDto['messages']): BaseMessage[] {
  return messages.map((message) => {
    switch (message.role) {
      case 'system':
        return new SystemMessage(message.content);
      case 'user':
        return new HumanMessage(message.content);
      case 'assistant':
        return new AIMessage(message.content);
    }
  });
}
