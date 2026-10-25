import { AppLogger, type MetaData } from '../app-logger.js';
import type { LogLevel } from '../logging-config.js';

export interface TimedOptions {
  level?: LogLevel;
  message?: string;
  metaData?: MetaData | ((args: readonly unknown[]) => MetaData | undefined);
}

const timedLogger = new AppLogger('Unknown');

function hostName(host: unknown): string {
  return (
    (host as { constructor?: { name?: string } } | undefined)?.constructor
      ?.name ?? 'Unknown'
  );
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof (value as PromiseLike<unknown> | undefined)?.then === 'function'
  );
}

function report(context: string, write: () => void): void {
  timedLogger.setContext(context);
  write();
}

export function Timed(options: TimedOptions = {}): MethodDecorator {
  return (_target, propertyKey, descriptor: PropertyDescriptor) => {
    const original = descriptor.value as (
      this: unknown,
      ...args: unknown[]
    ) => unknown;
    const operation = String(propertyKey);

    descriptor.value = function (this: unknown, ...args: unknown[]): unknown {
      const context = hostName(this);
      const startedAt = performance.now();
      const metaData =
        typeof options.metaData === 'function'
          ? options.metaData(args)
          : options.metaData;
      const durationMs = (): number =>
        Math.round((performance.now() - startedAt) * 10) / 10;

      const onSuccess = (): void =>
        report(context, () =>
          timedLogger.writeTimed(
            options.level ?? 'info',
            options.message ?? `${operation} completed`,
            { operation, durationMs: durationMs() },
            { metaData },
          ),
        );

      const onError = (err: unknown): void =>
        report(context, () =>
          timedLogger.writeTimed(
            'error',
            `${operation} failed`,
            { operation, durationMs: durationMs() },
            { metaData, err },
          ),
        );

      let result: unknown;
      try {
        result = original.apply(this, args);
      } catch (err) {
        onError(err);
        throw err;
      }

      if (isPromiseLike(result)) {
        return result.then(
          (value) => {
            onSuccess();
            return value;
          },
          (err: unknown) => {
            onError(err);
            throw err;
          },
        );
      }

      onSuccess();
      return result;
    };
  };
}
