import { Writable } from 'node:stream';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { buildLoggingParams, setLoggingParams } from './logging-config.js';
import { RequestLogMiddleware } from './request-log.middleware.js';

function captureLines(): string[] {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback): void {
      lines.push(String(chunk));
      callback();
    },
  });
  setLoggingParams(buildLoggingParams({ NODE_ENV: 'development' }, stream));
  return lines;
}

function parse(lines: string[]): Record<string, unknown>[] {
  return lines
    .join('')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

interface FakeRequestInit {
  method?: string;
  originalUrl?: string;
  path?: string;
  route?: { path: string };
  query?: Record<string, string>;
  headers?: Record<string, string>;
}

function fakeRequest(init: FakeRequestInit = {}): Request {
  return {
    method: init.method ?? 'GET',
    originalUrl: init.originalUrl ?? '/v1',
    path: init.path ?? '/v1',
    route: init.route,
    query: init.query ?? {},
    params: {},
    ip: '127.0.0.1',
    headers: init.headers ?? {},
  } as unknown as Request;
}

function fakeResponse(statusCode = 200, contentLength?: number): Response & { emit(event: string): void; err?: unknown } {
  const headers: Record<string, string | number> = {};
  if (contentLength !== undefined) headers['content-length'] = contentLength;
  const listeners: Record<string, () => void> = {};
  const res = {
    statusCode,
    setHeader(name: string, value: string | number): void {
      headers[name.toLowerCase()] = value;
    },
    getHeader(name: string): string | number | undefined {
      return headers[name.toLowerCase()];
    },
    on(event: string, listener: () => void): unknown {
      listeners[event] = listener;
      return res;
    },
    emit(event: string): void {
      listeners[event]?.();
    },
  };
  return res as unknown as Response & { emit(event: string): void; err?: unknown };
}

function serve(req: Request, res: ReturnType<typeof fakeResponse>, finish = 'finish'): void {
  new RequestLogMiddleware().use(req, res as unknown as Response, vi.fn());
  res.emit(finish);
}

describe('RequestLogMiddleware', () => {
  it('writes one request line with the request and the response fields', () => {
    const lines = captureLines();
    serve(
      fakeRequest({
        method: 'POST',
        originalUrl: '/v1/chat/stream?limit=20',
        path: '/v1/chat/stream',
        route: { path: '/v1/chat/stream' },
        query: { limit: '20' },
        headers: {
          'content-type': 'application/json',
          'content-length': '128',
          'user-agent': 'Mozilla/5.0',
        },
      }),
      fakeResponse(200, 4096),
    );
    const parsed = parse(lines);
    const [line] = parsed;

    expect(parsed).toHaveLength(1);
    expect(line?.['logType']).toBe('request');
    expect(line?.['method']).toBe('POST');
    expect(line?.['url']).toBe('/v1/chat/stream?limit=20');
    expect(line?.['path']).toBe('/v1/chat/stream');
    expect(line?.['route']).toBe('/v1/chat/stream');
    expect(line?.['query']).toEqual({ limit: '20' });
    expect(line?.['params']).toEqual({});
    expect(line?.['ip']).toBe('127.0.0.1');
    expect(line?.['userAgent']).toBe('Mozilla/5.0');
    expect(line?.['contentType']).toBe('application/json');
    expect(line?.['requestContentLength']).toBe(128);
    expect(line?.['statusCode']).toBe(200);
    expect(line?.['responseContentLength']).toBe(4096);
    expect(typeof line?.['durationMs']).toBe('number');
    expect(line?.['userId']).toBeNull();
    expect(line?.['err']).toBeNull();
  });

  it('chooses the level from the status code', () => {
    const lines = captureLines();
    serve(fakeRequest(), fakeResponse(200));
    serve(fakeRequest(), fakeResponse(404));
    serve(fakeRequest(), fakeResponse(500));
    const levels = parse(lines).map((line) => line['level']);

    expect(levels).toEqual(['info', 'warn', 'error']);
  });

  it('keeps the header values of the request out of the line', () => {
    const lines = captureLines();
    serve(
      fakeRequest({
        headers: { authorization: 'Bearer secret', cookie: 'session=1' },
      }),
      fakeResponse(200),
    );
    const [line] = parse(lines);
    const text = lines.join('');

    expect(line).not.toHaveProperty('headers');
    expect(text).not.toContain('secret');
    expect(text).not.toContain('session=1');
  });

  it('writes no line for a preflight request', () => {
    const lines = captureLines();
    serve(fakeRequest({ method: 'OPTIONS' }), fakeResponse(204));

    expect(lines).toEqual([]);
  });

  it('writes no line for a probe path', () => {
    const lines = captureLines();
    serve(fakeRequest({ path: '/health', originalUrl: '/health' }), fakeResponse(200));
    serve(fakeRequest({ path: '/v1/health', originalUrl: '/v1/health' }), fakeResponse(200));

    expect(lines).toEqual([]);
  });

  it('uses the trace id of the header when it is valid', () => {
    const lines = captureLines();
    serve(fakeRequest({ headers: { 'x-trace-id': 'abc12345' } }), fakeResponse(200));
    const [line] = parse(lines);

    expect(line?.['traceId']).toBe('abc12345');
  });

  it('writes a fresh trace id when the header is invalid', () => {
    const lines = captureLines();
    serve(fakeRequest({ headers: { 'x-trace-id': 'bad value' } }), fakeResponse(200));
    const [line] = parse(lines);

    expect(String(line?.['traceId'])).toMatch(/^trace_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(lines.join('')).not.toContain('bad value');
  });

  it('echoes the trace id on the response', () => {
    const lines = captureLines();
    const res = fakeResponse(200);
    serve(fakeRequest({ headers: { 'x-trace-id': 'abc12345' } }), res);
    const [line] = parse(lines);

    expect(res.getHeader('x-trace-id')).toBe('abc12345');
    expect(line?.['traceId']).toBe(res.getHeader('x-trace-id'));
  });

  it('writes the error of the response under the err key', () => {
    const lines = captureLines();
    const res = fakeResponse(500);
    res.err = new Error('boom');
    serve(fakeRequest(), res);
    const [line] = parse(lines);
    const err = line?.['err'] as Record<string, unknown>;

    expect(err['type']).toBe('Error');
    expect(err['message']).toBe('boom');
    expect(typeof err['stack']).toBe('string');
  });

  it('writes one line when the response closes without finishing', () => {
    const lines = captureLines();
    const res = fakeResponse(200);
    new RequestLogMiddleware().use(fakeRequest(), res as unknown as Response, vi.fn());
    res.emit('close');

    expect(parse(lines)).toHaveLength(1);
  });
});
