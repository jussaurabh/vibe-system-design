import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { LoggerModule } from 'pino-nestjs';

import { getLoggingParams } from './logging-config.js';
import { RequestLogMiddleware } from './request-log.middleware.js';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [],
      providers: [],
      useFactory: () => getLoggingParams(),
    }),
  ],
  providers: [RequestLogMiddleware],
})
export class LoggingModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLogMiddleware).forRoutes('*');
  }
}
