import { app } from 'electron';

const isDev = !app.isPackaged;

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function log(level: LogLevel, ...args: unknown[]): void {
  // In production suppress debug/info
  if (!isDev && (level === 'debug' || level === 'info')) return;

  const ts = new Date().toISOString();
  const prefix = `[${ts}] [${level.toUpperCase()}]`;

  switch (level) {
    case 'error':
      console.error(prefix, ...args);
      break;
    case 'warn':
      console.warn(prefix, ...args);
      break;
    default:
      console.log(prefix, ...args);
  }
}

export const logger = {
  debug: (...args: unknown[]) => log('debug', ...args),
  info:  (...args: unknown[]) => log('info',  ...args),
  warn:  (...args: unknown[]) => log('warn',  ...args),
  error: (...args: unknown[]) => log('error', ...args),
};
