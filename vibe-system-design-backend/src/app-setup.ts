import type { INestApplication } from '@nestjs/common';

export const GLOBAL_PREFIX = 'v1';

/**
 * Frontend origins that the API accepts when the env var is not set.
 */
export const DEFAULT_CORS_ORIGINS: readonly string[] = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

/**
 * Read the allowed origins from the env.
 *
 * The env var holds a comma separated list. An unset env var falls back to
 * the default list. A list that holds no entry blocks every cross origin
 * request.
 */
export function resolveCorsOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env['CORS_ORIGINS'];
  if (raw === undefined) return [...DEFAULT_CORS_ORIGINS];
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix(GLOBAL_PREFIX);
  // The CORS middleware answers the browser preflight request. Without it the
  // preflight returns 404 and the browser blocks the POST request.
  app.enableCors({
    origin: resolveCorsOrigins(),
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 86_400,
  });
}
