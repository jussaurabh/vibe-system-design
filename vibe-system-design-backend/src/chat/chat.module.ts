import { Module } from '@nestjs/common';

import { AgentServerModule } from '../agent-server/agent-server.module.js';
import { DbModule, DB, type DrizzleDb } from '../db/db.module.js';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';
import {
  CHAT_MESSAGES_REPOSITORY,
  DrizzleChatMessagesRepository,
} from './chat-messages.repository.js';

@Module({
  imports: [AgentServerModule, DbModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    {
      provide: CHAT_MESSAGES_REPOSITORY,
      useFactory: (db: DrizzleDb) => new DrizzleChatMessagesRepository(db),
      inject: [DB],
    },
  ],
})
export class ChatModule {}
