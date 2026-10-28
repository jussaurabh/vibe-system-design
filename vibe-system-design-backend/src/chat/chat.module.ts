import { Module } from '@nestjs/common';

import { AgentServerModule } from '../agent-server/agent-server.module.js';
import { AgentModule } from '../agent/agent.module.js';
import { DbModule } from '../db/db.module.js';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';

// The database and the agent modules still bootstrap until Task 5 cleans
// them out of the chat module.
@Module({
  imports: [AgentModule, DbModule, AgentServerModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
