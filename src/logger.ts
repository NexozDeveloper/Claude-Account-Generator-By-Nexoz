type Level = "info" | "ok" | "warn" | "error" | "debug";

const COLORS: Record<Level, string> = {
  info: "\x1b[36m",
  ok: "\x1b[32m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
  debug: "\x1b[90m",
};

const RESET = "\x1b[0m";

function stamp(): string {
  return new Date().toISOString().slice(11, 19);
}

export function log(level: Level, scope: string, message: string): void {
  const line = `${COLORS[level]}[${stamp()}] ${level.toUpperCase().padEnd(5)}${RESET} ${scope}  ${message}`;
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (scope: string, msg: string) => log("info", scope, msg),
  ok: (scope: string, msg: string) => log("ok", scope, msg),
  warn: (scope: string, msg: string) => log("warn", scope, msg),
  error: (scope: string, msg: string) => log("error", scope, msg),
  debug: (scope: string, msg: string) => log("debug", scope, msg),
};