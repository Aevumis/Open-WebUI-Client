// Simple scoped logger with level and scope filtering
// Usage:
// import { log, debug, info, warn, error, setLogConfig } from './log';
// setLogConfig({ level: 'info', scopes: ['sync','outbox','cache'] });

export type LogLevel = "error" | "warn" | "info" | "debug";

const LEVEL_ORDER: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

let CURRENT_LEVEL: LogLevel = "info";
let ALLOWED_SCOPES: Set<string> = new Set(["sync", "outbox", "cache", "webview", "webviewDrain"]);

export function setLogConfig(config: { level?: LogLevel; scopes?: string[] }) {
  if (config.level) CURRENT_LEVEL = config.level;
  if (config.scopes) ALLOWED_SCOPES = new Set(config.scopes);
}

function shouldLog(scope: string, level: LogLevel): boolean {
  return (
    LEVEL_ORDER[level] <= LEVEL_ORDER[CURRENT_LEVEL] &&
    (ALLOWED_SCOPES.has(scope) || ALLOWED_SCOPES.has("*"))
  );
}

export function log(scope: string, level: LogLevel, ...args: unknown[]) {
  if (!shouldLog(scope, level)) return;
  try {
    // eslint-disable-next-line no-console
    console.log(`[${scope}]`, ...args);
  } catch {}
}

export function debug(scope: string, ...args: unknown[]) {
  log(scope, "debug", ...args);
}
export function info(scope: string, ...args: unknown[]) {
  log(scope, "info", ...args);
}
export function warn(scope: string, ...args: unknown[]) {
  log(scope, "warn", ...args);
}
export function error(scope: string, ...args: unknown[]) {
  log(scope, "error", ...args);
}
