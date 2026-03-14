/** biome-ignore-all lint/suspicious/noConsole: console is used in the logger */
export type CreateLoggerOptions = {
  service: string;
  version?: string;
  level?: string;
  environment?: string;
};

type LogFn = (obj: unknown, msg?: string) => void;

export type AppLogger = {
  level: string;
  trace: LogFn;
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  fatal: LogFn;
  child(bindings: Record<string, unknown>): AppLogger;
};

const LEVEL_VALUES: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: Infinity,
};

const CONSOLE_FNS: Record<string, (...args: unknown[]) => void> = {
  trace: console.debug.bind(console),
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  fatal: console.error.bind(console),
};

function makeLogger(level: string, bindings?: Record<string, unknown>): AppLogger {
  const minValue = LEVEL_VALUES[level] ?? 30;
  const noop: LogFn = () => {};

  function makeLogFn(lvl: string): LogFn {
    if ((LEVEL_VALUES[lvl] ?? 0) < minValue) {
      return noop;
    }
    const consoleFn = CONSOLE_FNS[lvl] ?? console.log.bind(console);
    return (obj, msg) => {
      const out =
        bindings && typeof obj === "object" && obj !== null
          ? { ...bindings, ...obj }
          : bindings
            ? { ...bindings, msg: obj }
            : obj;
      if (msg !== undefined) {
        consoleFn(out, msg);
      } else {
        consoleFn(out);
      }
    };
  }

  return {
    level,
    trace: makeLogFn("trace"),
    debug: makeLogFn("debug"),
    info: makeLogFn("info"),
    warn: makeLogFn("warn"),
    error: makeLogFn("error"),
    fatal: makeLogFn("fatal"),
    child(b) {
      return makeLogger(level, { ...bindings, ...b });
    },
  };
}

export function createLogger(options: CreateLoggerOptions): AppLogger {
  const level =
    options.environment === "test"
      ? "silent"
      : (options.level ?? (options.environment === "development" ? "debug" : "info"));
  const bindings: Record<string, unknown> = { service: options.service };
  if (options.version) {
    bindings.version = options.version;
  }
  return makeLogger(level, bindings);
}
