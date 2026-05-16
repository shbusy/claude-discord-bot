import pino, { type Logger } from 'pino';

export function createLogger(): Logger {
  const level = process.env.LOG_LEVEL ?? 'info';
  return pino({
    level,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
