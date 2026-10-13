import { createHash, timingSafeEqual } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';
import { isEmpty, isString } from 'lodash-es';

import { getAuthSession } from '@service/auth/better-auth';
import { UnauthorizedError } from '@utils/errors';
import logger from '@utils/logger';

import { getBearerToken } from './auth-helpers';


interface ApiKeyMatch {
  id?: string;
  matched: boolean;
}

type ApiKeyRecord = ParsedApiKeyRecordWithHash | ParsedApiKeyRecordWithRaw;

interface ParsedApiKeyRecordBase {
  expiresAt?: string;
  hash: string;
  id?: string;
  label?: string;
}

type ParsedApiKeyRecordWithHash = ParsedApiKeyRecordBase & {
  kind: 'hashed';
  raw?: never;
};

type ParsedApiKeyRecordWithRaw = ParsedApiKeyRecordBase & {
  kind: 'raw';
  raw: string;
};


function hashApiKey(value: string) {
  return createHash('sha256').update(value).digest();
}

function isValidHashHex(hash: string) {
  return /^[0-9a-f]{64}$/i.test(hash);
}

function logApiKeyFailure(kind: 'admin' | 'service', reason: string, req: Request, keyId?: string) {
  logger.warn({ apiKeyId: keyId, ip: req.ip, kind, path: req.path, reason }, 'API key authentication failed');
}

function matchApiKey(providedKey: string, envValue: string | undefined): ApiKeyMatch {
  const records = readApiKeyRecords(envValue);
  let matchedRecord: ApiKeyRecord | undefined;

  for (const record of records) {
    if (!isValidHashHex(record.hash)) {
      logger.warn({ apiKeyId: record.id, hash: record.hash }, 'Skipping invalid API key hash record');
      continue;
    }
    if (record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()) {
      continue;
    }
    const expectedHash = hashApiKey(providedKey);
    if (timingSafeEqual(Buffer.from(record.hash, 'hex'), expectedHash)) {
      matchedRecord = record;
      break;
    }
    if (record.kind === 'raw' && safeCompare(providedKey, record.raw)) {
      matchedRecord = record;
      break;
    }
  }

  return { id: matchedRecord?.id, matched: Boolean(matchedRecord) };
}

async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const ctx = await getAuthSession(req.headers);
    if (ctx) {
      req.authUser = ctx;
    }
  } catch (error) {
    logger.error(`Session validation failed (optional auth): ${error}`);
  }
  next();
}

function readApiKeyRecords(envValue: string | undefined): ApiKeyRecord[] {
  if (!envValue?.trim()) {
    return [];
  }

  const trimmed = envValue.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) return [];
      return parsed.flatMap((entry): ApiKeyRecord[] => {
        if (isString(entry)) {
          return [{ hash: hashApiKey(entry).toString('hex'), kind: 'raw', raw: entry }];
        }
        if (entry && typeof entry === 'object') {
          const candidate = entry as Record<string, unknown>;
          const raw = candidate['raw'] ?? candidate['value'] ?? candidate['secret'];
          const hash = candidate['hash'];
          if (isString(hash)) {
            if (isString(raw)) {
              return [
                {
                  expiresAt: isString(candidate['expiresAt']) ? candidate['expiresAt'] : undefined,
                  hash,
                  id: isString(candidate['id']) ? candidate['id'] : undefined,
                  kind: 'raw',
                  label: isString(candidate['label']) ? candidate['label'] : undefined,
                  raw,
                },
              ];
            }
            return [
              {
                expiresAt: isString(candidate['expiresAt']) ? candidate['expiresAt'] : undefined,
                hash,
                id: isString(candidate['id']) ? candidate['id'] : undefined,
                kind: 'hashed',
                label: isString(candidate['label']) ? candidate['label'] : undefined,
              },
            ];
          }
          if (isString(raw)) {
            return [
              {
                expiresAt: isString(candidate['expiresAt']) ? candidate['expiresAt'] : undefined,
                hash: hashApiKey(raw).toString('hex'),
                id: isString(candidate['id']) ? candidate['id'] : undefined,
                kind: 'raw',
                label: isString(candidate['label']) ? candidate['label'] : undefined,
                raw,
              },
            ];
          }
        }
        return [];
      });
    } catch {
      // fall through to legacy raw key handling
    }
  }

  return [{ hash: hashApiKey(trimmed).toString('hex'), kind: 'raw', raw: trimmed }];
}

async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const ctx = await getAuthSession(req.headers);
    if (!ctx) {
      next(new UnauthorizedError('No valid session'));
      return;
    }
    req.authUser = ctx;
    next();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      next(error);
      return;
    }
    logger.error(`Session validation failed (required auth): ${error}`);
    next(new UnauthorizedError('Session validation failed'));
  }
}

async function requireBearerAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const ctx = await getAuthSession(req.headers);
    if (!ctx) {
      next(new UnauthorizedError('No valid session'));
      return;
    }
    req.authUser = ctx;
    next();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      next(error);
      return;
    }
    logger.error(`Session validation failed (bearer auth): ${error}`);
    next(new UnauthorizedError('Session validation failed'));
  }
}

function safeCompare(value: string, expected: string) {
  const a = hashApiKey(value);
  const b = hashApiKey(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Check for API key in the headers, read from env variable ADMIN_API_KEY
function adminAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const adminApiKey = process.env['ADMIN_API_KEY'];
    if (isEmpty(adminApiKey) || !isString(adminApiKey)) {
      next(new UnauthorizedError('API key is required'));
      return;
    }

    const apiKey = req.headers['x-api-key'];
    // Validate that API key is provided
    if (!apiKey || typeof apiKey !== 'string') {
      logApiKeyFailure('admin', 'missing-header', req);
      next(new UnauthorizedError('API key is required'));
      return;
    }
    const match = matchApiKey(apiKey, adminApiKey);
    if (!match.matched) {
      logApiKeyFailure('admin', 'invalid-key', req, match.id);
      next(new UnauthorizedError('Invalid API key'));
      return;
    }
    (req as Request & { apiKeyId?: string }).apiKeyId = match.id;
    logger.info({ apiKeyId: match.id, kind: 'admin', path: req.path }, 'API key authentication succeeded');
    next();
  } catch (error) {
    logger.error(`API key validation failed (admin auth): ${error}`);
    next(new UnauthorizedError('Invalid API key'));
  }
}

function serviceAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const serviceApiKey = process.env['INTERNAL_SERVICE_API_KEY'];
    if (!isString(serviceApiKey) || isEmpty(serviceApiKey)) {
      next(new UnauthorizedError('Service API key is required'));
      return;
    }

    const apiKey = req.headers['x-service-api-key'];
    if (!apiKey || typeof apiKey !== 'string') {
      logApiKeyFailure('service', 'missing-header', req);
      next(new UnauthorizedError('Service API key is required'));
      return;
    }

    const match = matchApiKey(apiKey, serviceApiKey);
    if (!match.matched) {
      logApiKeyFailure('service', 'invalid-key', req, match.id);
      next(new UnauthorizedError('Invalid service API key'));
      return;
    }

    (req as Request & { apiKeyId?: string }).apiKeyId = match.id;
    logger.info({ apiKeyId: match.id, kind: 'service', path: req.path }, 'API key authentication succeeded');

    next();
  } catch (error) {
    logger.error(`API key validation failed (service auth): ${error}`);
    next(new UnauthorizedError('Invalid service API key'));
  }
}

export { adminAuth, getBearerToken, optionalAuth, requireAuth, requireBearerAuth, serviceAuth };
