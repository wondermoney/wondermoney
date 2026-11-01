import pino, { type LoggerOptions } from 'pino';

import { SHOULD_PRETTY_LOGS } from '@config/env';

// Configure logger options
const options: LoggerOptions = {
  formatters: {
    level: (label) => ({ level: label }),
  },
  level: SHOULD_PRETTY_LOGS ? 'debug' : 'info',
  // BYOK provider credentials (Enable Banking) are stored encrypted and decrypted
  // in-process only for the duration of a single provider call — they must never
  // reach a log line or, from there, Sentry. `remove: true` drops the key entirely
  // rather than leaving a `[Redacted]` placeholder that still confirms shape.
  // `error.config.data`/`error.config.headers.authorization` cover an Axios error
  // logged whole (`logger.error({ error }, ...)`), whose `config` carries the
  // outgoing request body/headers of the call that failed — which, for an Enable
  // Banking JWT-signing call, could be the private key itself.
  redact: {
    paths: [
      '*.privateKeyPem',
      '*.privateKeyCiphertext',
      '*.privateKeyIv',
      '*.privateKeyAuthTag',
      'error.config.data',
      'error.config.headers.authorization',
    ],
    remove: true,
  },
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: SHOULD_PRETTY_LOGS
    ? {
        options: {
          colorize: true,
          destination: 1,
          errorLikeObjectKeys: ['err', 'error'],
          ignore: 'pid,hostname',
          singleLine: false,
          translateTime: 'HH:MM:ss.l',
        },
        target: 'pino-pretty',
      }
    : undefined,
};

// pino writes to stdout by default (and to the pino-pretty transport above when
// SHOULD_PRETTY_LOGS is set). Don't wrap it in a single-element
// `pino.multistream([{ stream: process.stdout }])`: that is a no-op with extra
// overhead that also silently disables the transport.
const logger = pino(options);

export default logger;
