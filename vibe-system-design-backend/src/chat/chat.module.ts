import { Module } from '@nestjs/common';

import { AgentServerModule } from '../agent-server/agent-server.module.js';
import { AgentModule } from '../agent/agent.module.js';
import type { DrizzleDb } from '../db/db.client.js';
import { DB, DbModule } from '../db/db.module.js';
import { ChatController } from './chat.controller.js';
import { CHAT_REPOSITORY, DrizzleChatRepository } from './chat.repository.js';
import { ChatService } from './chat.service.js';

@Module({
  imports: [AgentModule, DbModule, AgentServerModule],
  controllers: [ChatController],
  providers: [
    {
      provide: CHAT_REPOSITORY,
      useFactory: (db: DrizzleDb) => new DrizzleChatRepository(db),
      inject: [DB],
    },
    ChatService,
  ],
})
export class ChatModule {}
