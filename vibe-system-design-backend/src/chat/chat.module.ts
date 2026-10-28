import { Module } from '@nestjs/common';

import { AgentServerModule } from '../agent-server/agent-server.module.js';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';

@Module({
  imports: [AgentServerModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
