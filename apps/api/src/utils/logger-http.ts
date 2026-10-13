import { randomUUID } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';

import pino from 'pino';
import pinoHttp from 'pino-http';

import { sanitizeErrorParams, sanitizeErrorQuery, sanitizeErrorUrl } from './error-sanitizer';
import logger from './logger';

function sanitizeQuery(query: unknown): unknown {
  if (!query || typeof query !== 'object' || Array.isArray(query)) return query;
  const safeKeys = new Set(['direction', 'limit', 'offset', 'order', 'page', 'sort']);
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query)) {
    sanitized[key] = safeKeys.has(key) && ['boolean', 'number', 'string'].includes(typeof value) ? value : '[REDACTED]';
  }
  return sanitized;
}

const httpLogger = pinoHttp({
  customAttributeKeys: {
    err: 'error',
    req: 'request',
    res: 'response',
  },
  customErrorMessage(req: IncomingMessage, res: ServerResponse, err: Error) {
    return `${req.method} ${sanitizeErrorUrl(req.url ?? '')} ${res.statusCode}: ${err.message}`;
  },
  customLogLevel(_req: IncomingMessage, res: ServerResponse, err?: Error) {
    if (err) return 'error';
    if (!res.statusCode) return 'info';
    if (res.statusCode >= 400 && res.statusCode < 500) return 'warn';
    if (res.statusCode >= 300 && res.statusCode < 400) return 'silent';
    if (res.statusCode >= 500) return 'error';
    if (res.statusCode >= 200 && res.statusCode < 300) return 'info';
    return 'info';
  },
  customReceivedMessage(req: IncomingMessage) {
    return `${req.method} ${sanitizeErrorUrl(req.url ?? '')}`;
  },
  customSuccessMessage(req: IncomingMessage, res: ServerResponse, responseTime: number) {
    if (res.statusCode === 404) return 'resource not found';
    return `${req.method} ${sanitizeErrorUrl(req.url ?? '')} ${res.statusCode} ${responseTime}ms`;
  },
  genReqId(req: IncomingMessage, res: ServerResponse) {
    const existingID = req.headers['x-request-id'];
    if (existingID) return existingID;
    const id = randomUUID();
    res.setHeader('X-Request-Id', id);
    return id;
  },
  logger: logger as unknown as pino.Logger<'error' | 'info' | 'silent' | 'warn'>,
  serializers: {
    err: pino.stdSerializers.err,
    req: (req) => {
      const baseInfo = {
        method: req.method,
        url: sanitizeErrorUrl(req.url),
      };

      if (req.res?.statusCode && req.res.statusCode >= 400) {
        return {
          ...baseInfo,
          headers: {
            authorization: req.headers.authorization ? '[REDACTED]' : undefined,
            'content-length': req.headers['content-length'],
            'content-type': req.headers['content-type'],
            'user-agent': req.headers['user-agent'],
            'x-request-id': req.headers['x-request-id'],
          },
          parameters: sanitizeErrorParams(req.params),
          query: sanitizeQuery(sanitizeErrorQuery(req.query)),
          remoteAddress: req.connection?.remoteAddress,
        };
      }

      return baseInfo;
    },
    res: (res) => ({
      statusCode: res.statusCode,
      statusMessage: res.statusMessage,
    }),
  },
  wrapSerializers: true,
});

export default httpLogger;
