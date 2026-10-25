import type { Logger } from 'pino';
import { PinoLogger } from 'pino-nestjs';

import { getLoggingParams, getRootLogger, type LoggingParams, type LogLevel } from './logging-config.js';
import { currentRequestContext } from './request-context.js';

export type MetaData = Record<string, unknown>;

type Fields = Record<string, unknown>;

export class AppLogger extends PinoLogger {
  constructor(context: string, params: LoggingParams = getLoggingParams()) {
    super(params);
    this.setContext(context);
  }

  override get logger(): Logger {
    return getRootLogger();
  }

  override debug(message: string, metaData?: MetaData): void;
  override debug(obj: unknown, msg?: string, ...args: unknown[]): void;
  override debug(message: unknown, metaData?: unknown): void {
    this.write('debug', message, metaData);
  }

  override info(message: string, metaData?: MetaData): void;
  override info(obj: unknown, msg?: string, ...args: unknown[]): void;
  override info(message: unknown, metaData?: unknown): void {
    this.write('info', message, metaData);
  }

  override warn(message: string, metaData?: MetaData): void;
  override warn(obj: unknown, msg?: string, ...args: unknown[]): void;
  override warn(message: unknown, metaData?: unknown): void {
    this.write('warn', message, metaData);
  }

  override error(message: string, errOrMetaData?: unknown): void;
  override error(obj: unknown, msg?: string, ...args: unknown[]): void;
  override error(message: unknown, errOrMetaData?: unknown): void {
    this.write('error', message, errOrMetaData);
  }

  startTimer(name: string): (result?: { metaData?: MetaData }) => void {
    const startedAt = performance.now();
    return (result) => {
      const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
      this.writeTimed('info', `${name} completed`, { operation: name, durationMs }, { metaData: result?.metaData });
    };
  }

  writeTimed(
    level: LogLevel,
    message: string,
    timing: { operation: string; durationMs: number },
    options?: { metaData?: MetaData; err?: unknown },
  ): void {
    const fields: Fields = { ...this.appFields(), operation: timing.operation, durationMs: timing.durationMs };
    if (options?.metaData !== undefined) fields['metaData'] = options.metaData;
    if (options?.err !== undefined) fields['err'] = options.err;
    this.call(level, fields, message);
  }

  private write(level: LogLevel, message: unknown, extra?: unknown): void {
    if (typeof message !== 'string') {
      const fields = { ...this.appFields(), ...(message as Fields) };
      this.call(level, fields, typeof extra === 'string' ? extra : undefined);
      return;
    }
    const fields = this.appFields();
    if (extra instanceof Error && level === 'error') {
      fields['err'] = extra;
    } else if (extra !== undefined) {
      fields['metaData'] = extra;
    }
    this.call(level, fields, message);
  }

  private appFields(): Fields {
    const fields: Fields = {};
    const context = currentRequestContext();
    if (context !== undefined) {
      fields['requestId'] = context.requestId;
      fields['traceId'] = context.traceId;
      fields['seq'] = context.nextSeq();
    }
    return fields;
  }
}
