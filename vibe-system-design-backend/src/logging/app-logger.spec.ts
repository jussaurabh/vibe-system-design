import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { AppLogger } from './app-logger.js';
import { buildLoggingParams, setLoggingParams } from './logging-config.js';
import { createRequestContext, runInRequestContext } from './request-context.js';

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

describe('AppLogger', () => {
  it('writes one line with the level, the context, and the message', () => {
    const lines = captureLines();
    new AppLogger('ChatService').info('User message stored');
    const [line] = parse(lines);

    expect(parse(lines)).toHaveLength(1);
    expect(line?.['level']).toBe('info');
    expect(line?.['context']).toBe('ChatService');
    expect(line?.['message']).toBe('User message stored');
    expect(line?.['logType']).toBe('app');
  });

  it('nests the metadata under the metaData key', () => {
    const lines = captureLines();
    new AppLogger('ChatService').info('Stored', { sessionId: 'ses_01JA' });
    const [line] = parse(lines);

    expect(line?.['metaData']).toEqual({ sessionId: 'ses_01JA' });
    expect(line).not.toHaveProperty('sessionId');
  });

  it('keeps a metadata key from overwriting a reserved field', () => {
    const lines = captureLines();
    new AppLogger('ChatService').info('Stored', {
      context: 'other',
      level: 'error',
      requestId: 'req_x',
    });
    const [line] = parse(lines);

    expect(line?.['context']).toBe('ChatService');
    expect(line?.['level']).toBe('info');
    expect(line?.['metaData']).toEqual({ context: 'other', level: 'error', requestId: 'req_x' });
  });

  it('adds the request id, the trace id, and the sequence number inside a request', () => {
    const lines = captureLines();
    const logger = new AppLogger('ChatService');
    runInRequestContext(createRequestContext('req_1', 'trace_1'), () => {
      logger.info('first');
      logger.info('second');
    });
    const [first, second] = parse(lines);

    expect(first?.['requestId']).toBe('req_1');
    expect(first?.['traceId']).toBe('trace_1');
    expect(first?.['seq']).toBe(1);
    expect(second?.['seq']).toBe(2);
  });

  it('leaves the request fields out outside a request', () => {
    const lines = captureLines();
    new AppLogger('ChatService').info('outside');
    const [line] = parse(lines);

    expect(line).not.toHaveProperty('requestId');
    expect(line).not.toHaveProperty('traceId');
    expect(line).not.toHaveProperty('seq');
  });

  it('writes the error under the err key', () => {
    const lines = captureLines();
    new AppLogger('ChatService').error('Failed', new Error('boom'));
    const [line] = parse(lines);
    const err = line?.['err'] as Record<string, unknown>;

    expect(line?.['level']).toBe('error');
    expect(err['type']).toBe('Error');
    expect(err['message']).toBe('boom');
    expect(typeof err['stack']).toBe('string');
  });

  it('writes the metadata under the metaData key when the second argument is not an error', () => {
    const lines = captureLines();
    new AppLogger('ChatService').error('Failed', { docId: 'doc_42' });
    const [line] = parse(lines);

    expect(line?.['metaData']).toEqual({ docId: 'doc_42' });
    expect(line).not.toHaveProperty('err');
  });

  it('writes one timed line with the operation and the duration', () => {
    const lines = captureLines();
    const logger = new AppLogger('ChatService');
    logger.startTimer('fetchChunks')({ metaData: { chunkCount: 3 } });
    const parsed = parse(lines);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.['operation']).toBe('fetchChunks');
    expect(parsed[0]?.['durationMs']).toBeGreaterThanOrEqual(0);
    expect(parsed[0]?.['metaData']).toEqual({ chunkCount: 3 });
    expect(parsed[0]?.['level']).toBe('info');
  });
});
