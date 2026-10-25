import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ChatModule } from './chat/chat.module.js';
import { LoggingModule } from './logging/logging.module.js';

@Module({
  imports: [LoggingModule, ChatModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
