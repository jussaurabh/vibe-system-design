import { NestFactory } from '@nestjs/core';
import { Logger, LoggerErrorInterceptor } from 'pino-nestjs';
import { AppModule } from './app.module.js';
import { configureApp } from './app-setup.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.useGlobalInterceptors(new LoggerErrorInterceptor());
  configureApp(app);
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
