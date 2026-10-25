import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import {
  buildLoggingParams,
  buildPinoOptions,
  getRootLogger,
  resolveEnvName,
  resolveLogLevel,
  setLoggingParams,
} from './logging-config.js';

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

describe('logging config', () => {
  it('resolves the level from the environment', () => {
    expect(resolveLogLevel({})).toBe('debug');
    expect(resolveLogLevel({ NODE_ENV: 'production' })).toBe('info');
  });

  it('builds the options with the level of the environment', () => {
    expect(buildPinoOptions({ NODE_ENV: 'production' }).level).toBe('info');
    expect(buildPinoOptions({}).level).toBe('debug');
  });

  it('resolves the environment name', () => {
    expect(resolveEnvName({})).toBe('development');
    expect(resolveEnvName({ NODE_ENV: 'production' })).toBe('production');
  });

  it('prints the pid, the environment, and the service, and never the hostname', () => {
    const lines = captureLines();
    getRootLogger().info('base fields');
    const [line] = parse(lines);

    expect(line?.['pid']).toBe(process.pid);
    expect(line?.['env']).toBe('development');
    expect(line?.['service']).toBe('vibe-system-design-backend');
    expect(line).not.toHaveProperty('hostname');
  });

  it('prints the time as epoch milliseconds and the level as a name', () => {
    const lines = captureLines();
    getRootLogger().info('time and level');
    const [line] = parse(lines);

    expect(typeof line?.['time']).toBe('number');
    expect(line?.['time'] as number).toBeGreaterThan(1_700_000_000_000);
    expect(line?.['level']).toBe('info');
  });

  it('adds the log type app to every line and keeps an explicit log type', () => {
    const lines = captureLines();
    getRootLogger().info({ hello: 'world' }, 'plain');
    getRootLogger().info({ logType: 'request' }, 'request line');
    const [plain, request] = parse(lines);

    expect(plain?.['logType']).toBe('app');
    expect(request?.['logType']).toBe('request');
  });

  it('drops the request and the response bindings from every line', () => {
    const lines = captureLines();
    getRootLogger()
      .child({ req: { headers: { authorization: 'Bearer secret' } }, res: { statusCode: 200 } })
      .info({}, 'child');
    const [line] = parse(lines);

    expect(line).not.toHaveProperty('req');
    expect(line).not.toHaveProperty('res');
    expect(lines.join('')).not.toContain('secret');
  });

  it('writes to the given stream', () => {
    const lines = captureLines();
    getRootLogger().info('written to the stream');

    expect(parse(lines)[0]?.['message']).toBe('written to the stream');
  });
});
