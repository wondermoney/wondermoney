import type { NextFunction, Request, Response } from 'express';

import { authenticateApiToken, CALENDAR_FEED_TOKEN_SCOPE } from '@service/api-token/api-token.service';
import { NotFoundError } from '@utils/errors';

/**
 * Resolve the calendar feed's query-string credential before the rate limiter runs.
 *
 * Calendar apps cannot send an `Authorization` header, so the token travels in the query. Doing
 * the lookup here (rather than in the handler) lets the limiter key its bucket on the token's own
 * row, the same shape personal API tokens use, instead of on an arbitrary string a caller could
 * rotate to escape a bucket. An unknown, revoked or expired token — or a personal read/write token
 * that lacks `calendar:read` — is a 404, so the route never confirms that a token was recognised.
 */
export async function requireCalendarFeedToken(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = typeof req.query['token'] === 'string' ? req.query['token'] : undefined;
    const authenticated = token ? await authenticateApiToken(token, { ip: req.ip }) : null;
    if (!authenticated?.apiToken.scopes.includes(CALENDAR_FEED_TOKEN_SCOPE)) {
      next(new NotFoundError('Calendar feed not found'));
      return;
    }

    // The token acts as its owner: `req.user` and `req.tenant` are what the tenant filter and the
    // private-account carve-out read, exactly as they do for a signed-in request.
    req.apiToken = { apiTokenKey: authenticated.apiToken.apiTokenKey, scopes: authenticated.apiToken.scopes };
    req.tenant = authenticated.tenant;
    req.user = authenticated.appuser;
    next();
  } catch (error) {
    next(error);
  }
}
