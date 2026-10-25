import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';

export const SERVICE_NAME = 'vibe-system-design-backend';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type PinoOptions = LoggerOptions & {
  readonly stream?: DestinationStream;
  readonly autoLogging?: boolean;
};

export interface LoggingParams {
  readonly pinoHttp: PinoOptions;
}

export function resolveEnvName(env: NodeJS.ProcessEnv = process.env): string {
  return env['NODE_ENV'] ?? 'development';
}

export function resolveLogLevel(env: NodeJS.ProcessEnv = process.env): 'debug' | 'info' {
  return resolveEnvName(env) === 'production' ? 'info' : 'debug';
}

export function buildPinoOptions(
  env: NodeJS.ProcessEnv = process.env,
  stream?: DestinationStream,
): PinoOptions {
  const options: LoggerOptions = {
    level: resolveLogLevel(env),
    base: { pid: process.pid, env: resolveEnvName(env), service: SERVICE_NAME },
    timestamp: () => `,"time":${Date.now()}`,
    messageKey: 'message',
    formatters: {
      level: (label) => ({ level: label }),
      log: (object) => ({ logType: 'app', ...object }),
    },
    serializers: { req: () => undefined, res: () => undefined },
  };
  return stream === undefined ? options : { ...options, stream };
}

export function buildLoggingParams(
  env: NodeJS.ProcessEnv = process.env,
  stream?: DestinationStream,
): LoggingParams {
  return { pinoHttp: { ...buildPinoOptions(env, stream), autoLogging: false } };
}

let currentParams: LoggingParams = buildLoggingParams();
let rootLogger: Logger | undefined;

export function getLoggingParams(): LoggingParams {
  return currentParams;
}

export function setLoggingParams(params: LoggingParams): void {
  currentParams = params;
  rootLogger = undefined;
}

export function getRootLogger(): Logger {
  if (rootLogger === undefined) {
    const { stream, ...options } = currentParams.pinoHttp;
    rootLogger = stream === undefined ? pino(options) : pino(options, stream);
  }
  return rootLogger;
}
