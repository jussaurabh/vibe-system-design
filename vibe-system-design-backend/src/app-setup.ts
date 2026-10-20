import type { INestApplication } from '@nestjs/common';

export const GLOBAL_PREFIX = 'v1';

export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix(GLOBAL_PREFIX);
}
