export type LogLevel = "debug" | "info" | "warn" | "error";

const logMethods: Record<LogLevel, (...values: unknown[]) => void> = {
  debug: console.debug,
  info: console.info,
  warn: console.warn,
  error: console.error,
};

export const logger = {
  debug(scope: string, message: string, ...details: unknown[]) {
    logMethods.debug(`[Peter:${scope}] ${message}`, ...details);
  },
  info(scope: string, message: string, ...details: unknown[]) {
    logMethods.info(`[Peter:${scope}] ${message}`, ...details);
  },
  warn(scope: string, message: string, ...details: unknown[]) {
    logMethods.warn(`[Peter:${scope}] ${message}`, ...details);
  },
  error(scope: string, message: string, ...details: unknown[]) {
    logMethods.error(`[Peter:${scope}] ${message}`, ...details);
  },
};
