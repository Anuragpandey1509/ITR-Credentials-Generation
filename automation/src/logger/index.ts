import pino from 'pino';

// Simple logger for the automation process
// Output goes to stdout/stderr — captured by the service's child process watcher
export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'debug',
  transport:
    process.env['NODE_ENV'] !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  redact: {
    paths: ['pan', 'otp', 'password'],
    censor: '[REDACTED]',
  },
});
