import pino from 'pino';

const isTest = process.env.NODE_ENV === 'test';

export const logger = pino({
  level: isTest ? (process.env.LOG_LEVEL || 'silent') : (process.env.LOG_LEVEL || 'info'),
  base: { service: 'erp-backend' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization', 'req.headers.cookie',
      '*.password', '*.passwordHash', '*.token', '*.refreshToken', '*.accessToken',
      '*.secret', '*.apiKey', '*.encryptionKey', '*.credentials',
    ],
    censor: '[REDACTED]',
  },
});
