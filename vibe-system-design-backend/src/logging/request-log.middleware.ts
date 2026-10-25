import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { getRootLogger } from './logging-config.js';
import { createRequestContext, runInRequestContext } from './request-context.js';
import { isValidTraceId, newRequestId, newTraceId } from './utils/trace.js';

export const IGNORED_REQUEST_PATHS: readonly string[] = ['/health', '/ping'];

function headerValue(req: Request, name: string): string | null {
  const value = req.headers[name];
  return typeof value === 'string' ? value : null;
}

function parseLength(value: string | null): number | null {
  return value !== null && /^\d+$/.test(value) ? Number(value) : null;
}

export function isIgnoredRequest(req: Request): boolean {
  if (req.method === 'OPTIONS') return true;
  return IGNORED_REQUEST_PATHS.some((path) => req.path.endsWith(path));
}

export function resolveTraceId(req: Request): string {
  const value = headerValue(req, 'x-trace-id');
  return value !== null && isValidTraceId(value) ? value : newTraceId();
}

export function buildRequestLogFields(
  req: Request,
  res: Response,
  durationMs: number,
): Record<string, unknown> {
  const responseLength = res.getHeader('content-length');
  return {
    method: req.method,
    url: req.originalUrl,
    path: req.path,
    route: typeof req.route?.path === 'string' ? req.route.path : null,
    query: req.query,
    params: req.params,
    ip: req.ip,
    userAgent: headerValue(req, 'user-agent'),
    contentType: headerValue(req, 'content-type'),
    requestContentLength: parseLength(headerValue(req, 'content-length')),
    statusCode: res.statusCode,
    responseContentLength:
      responseLength === undefined ? null : parseLength(String(responseLength)),
    durationMs,
    userId: null,
    err: (res as Response & { err?: unknown }).err ?? null,
  };
}

@Injectable()
export class RequestLogMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const startedAt = performance.now();
    const traceId = resolveTraceId(req);
    res.setHeader('x-trace-id', traceId);
    const context = createRequestContext(newRequestId(), traceId);

    let written = false;
    const writeLine = (): void => {
      if (written) return;
      written = true;
      if (isIgnoredRequest(req)) return;

      const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
      const fields = {
        logType: 'request',
        requestId: context.requestId,
        traceId,
        ...buildRequestLogFields(req, res, durationMs),
      };
      const logger = getRootLogger();
      if (res.statusCode < 400) {
        logger.info(fields, 'request completed');
      } else if (res.statusCode < 500) {
        logger.warn(fields, 'request completed');
      } else {
        logger.error(fields, 'request completed');
      }
    };

    res.on('finish', writeLine);
    res.on('close', writeLine);
    runInRequestContext(context, () => next());
  }
}
