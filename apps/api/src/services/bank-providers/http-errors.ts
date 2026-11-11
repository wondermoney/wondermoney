import { BadGatewayError, BadRequestError, TooManyRequestsError, UnauthorizedError } from '@utils/errors';

import { ConsentExpiredError, RateLimitedError, UnavailableError, UserActionRequiredError } from './errors';

/**
 * Translate the interface's typed provider failures into the HTTP errors the controllers and
 * the global handler already speak. The sync path uses the typed errors directly (they carry the
 * incident code); a request path needs a status and, for a rate limit, `Retry-After`.
 */
export function toHttpError(error: unknown): unknown {
  if (error instanceof RateLimitedError) return new TooManyRequestsError(error.message, error.retryAfterSeconds);
  if (error instanceof ConsentExpiredError) return new UnauthorizedError(error.message);
  if (error instanceof UserActionRequiredError) return new BadRequestError(error.message);
  if (error instanceof UnavailableError) return new BadGatewayError(error.message);
  return error;
}
