import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { buildLoggingParams, setLoggingParams } from '../logging-config.js';
import { Timed } from './timed.js';

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

class DemoService {
  @Timed()
  async buildIndex(docId: string): Promise<string> {
    return docId;
  }

  @Timed({ level: 'debug', message: 'embedding refresh' })
  async refresh(): Promise<void> {}

  @Timed()
  async failing(): Promise<void> {
    throw new Error('boom');
  }

  @Timed({ metaData: (args) => ({ docId: args[0] }) })
  async lookup(docId: string): Promise<string> {
    return docId;
  }
}

describe('Timed', () => {
  it('writes one line with the operation, the duration, and the context of the host class', async () => {
    const lines = captureLines();
    await new DemoService().buildIndex('doc_42');
    const parsed = parse(lines);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.['operation']).toBe('buildIndex');
    expect(parsed[0]?.['durationMs']).toBeGreaterThanOrEqual(0);
    expect(parsed[0]?.['context']).toBe('DemoService');
    expect(parsed[0]?.['level']).toBe('info');
  });

  it('writes the level and the message from the options', async () => {
    const lines = captureLines();
    await new DemoService().refresh();
    const [line] = parse(lines);

    expect(line?.['level']).toBe('debug');
    expect(line?.['message']).toBe('embedding refresh');
  });

  it('writes the error line and rethrows the error', async () => {
    const lines = captureLines();

    await expect(new DemoService().failing()).rejects.toThrow('boom');
    const [line] = parse(lines);
    const err = line?.['err'] as Record<string, unknown>;

    expect(parse(lines)).toHaveLength(1);
    expect(line?.['level']).toBe('error');
    expect(line?.['message']).toBe('failing failed');
    expect(line?.['operation']).toBe('failing');
    expect(err['message']).toBe('boom');
  });

  it('writes the metadata from the options', async () => {
    const lines = captureLines();
    await new DemoService().lookup('doc_42');
    const [line] = parse(lines);

    expect(line?.['metaData']).toEqual({ docId: 'doc_42' });
  });
});
