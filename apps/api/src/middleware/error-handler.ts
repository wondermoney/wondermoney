import * as Sentry from '@sentry/node';
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { APP_ENV } from '@config/env';
import { ERROR } from '@utils/constants';
import { sanitizeRequestForLogging } from '@utils/error-sanitizer';
import { ERROR_CODE, statusToErrorCode } from '@utils/errors';
import logger from '@utils/logger';

export interface HttpError {
  /** Stable machine-readable reason — see `ERROR_CODE` in `utils/errors.ts`. */
  code?: string;
  message?: string;
  retryAfter?: number;
  status?: number;
}

/** The status the error is answered with. Anything without one is an unexpected failure. */
function errorStatus(err: unknown): number {
  if (err instanceof ZodError) return 422;
  const status = (err as HttpError | undefined)?.status;
  return typeof status === 'number' && status >= 400 ? status : 500;
}

/**
 * Only genuine server failures (5xx and anything thrown without a status) are faults worth an
 * error log and a Sentry event. Client errors (validation, auth, not-found) are normal outcomes,
 * and a feature this server has not configured (501 `feature_disabled`) is a deployment choice.
 */
function isServerFault(err: unknown): boolean {
  if ((err as HttpError | undefined)?.code === ERROR_CODE.FEATURE_DISABLED) return false;
  return errorStatus(err) >= 500;
}

/** The API's last error middleware: logs, reports server faults to Sentry, answers the client. */
export function errorHandler(err: HttpError, req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) {
    next(err);
    return;
  }
  const status = errorStatus(err);
  const code: string = typeof err.code === 'string' ? err.code : err instanceof ZodError ? ERROR_CODE.VALIDATION_FAILED : statusToErrorCode(status);

  if (isServerFault(err)) {
    const sanitized = sanitizeRequestForLogging(req.path, {
      body: req.body,
      cookies: req.cookies,
      data: req.body,
      headers: req.headers,
      query: req.query,
    });
    Sentry.captureException(err, { extra: { request: sanitized } });
    logger.error(
      {
        error: err,
        request: {
          ...sanitized,
          method: req.method,
          params: req.params,
          url: req.path,
          user: req.user?.appuserKey,
        },
        timestamp: new Date().toISOString(),
      },
      '🚨  Something went wrong',
    );
  } else {
    // One line with the reason; the request itself is already logged by pino-http.
    logger.warn(
      {
        code,
        method: req.method,
        status,
        url: req.path,
        user: req.user?.appuserKey,
        ...(err instanceof ZodError ? { validationErrors: err.issues } : {}),
      },
      `${req.method} ${req.path} ${status}: ${err.message ?? code}`,
    );
  }

  if (err instanceof ZodError) {
    return res.status(422).json({ code, message: err.message });
  }
  // Surface a rate-limit backoff hint to the client when the error carries one.
  if (typeof err.retryAfter === 'number' && Number.isFinite(err.retryAfter)) {
    res.setHeader('Retry-After', String(Math.ceil(err.retryAfter)));
  }
  // `code` is the stable, machine-readable reason. It is emitted in every environment and for
  // every status — including 5xx, where the message is deliberately withheld — because a client
  // branching on the reason must not have to parse English prose. See `ERROR_CODE`.

  // In production/staging: hide details for 5xx, show message for 4xx
  if (APP_ENV === 'production' || APP_ENV === 'staging') {
    const message = status >= 500 ? ERROR.SERVER : err.message || ERROR.SERVER;
    return res.status(status).json({ code, message });
  }
  return res.status(status).json({ code, message: err.message || ERROR.SERVER });
}
