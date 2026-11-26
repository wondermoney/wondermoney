import type { NextFunction, Request, Response } from 'express';

import { verifyTotpForSession } from '@service/auth/better-auth';
import { SENSITIVE_SESSION_MAX_AGE_MS } from '@service/auth/sensitive-session-age';
import { ERROR_CODE, ForbiddenError, UnauthorizedError } from '@utils/errors';

export { SENSITIVE_SESSION_MAX_AGE_MS };

/**
 * Gate a sensitive account action on a fresh session, plus TOTP when the user has it enabled.
 *
 * Personal API tokens are rejected outright: a token must never be able to create, list or
 * revoke tokens. The API-token scope allowlist already excludes `/v1/user`; this is the second,
 * explicit check at the route that owns token management.
 *
 * TOTP is revalidated through better-auth's own `/two-factor/verify-totp` endpoint
 * (`verifyTotpForSession`), which verifies the code against the stored secret and throws on a
 * wrong or expired one. The code arrives in `x-totp-code`, never in the URL.
 */
export async function requireSensitiveSession(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (req.apiToken) {
    next(new ForbiddenError('API tokens cannot manage API tokens.', ERROR_CODE.API_TOKEN_SCOPE_REQUIRED));
    return;
  }

  const authUser = req.authUser;
  if (!authUser) {
    next(new UnauthorizedError('No valid session'));
    return;
  }

  const createdAt = new Date(authUser.session.createdAt).getTime();
  if (!Number.isFinite(createdAt) || Date.now() - createdAt > SENSITIVE_SESSION_MAX_AGE_MS) {
    next(new ForbiddenError('Please sign in again to continue.', ERROR_CODE.SESSION_NOT_FRESH));
    return;
  }

  if (authUser.user.twoFactorEnabled) {
    const code = req.get('x-totp-code')?.trim();
    if (!code) {
      next(new ForbiddenError('Enter your authenticator code to continue.', ERROR_CODE.TOTP_REQUIRED));
      return;
    }
    try {
      await verifyTotpForSession(req.headers, code);
    } catch {
      next(new ForbiddenError('That authenticator code is not valid.', ERROR_CODE.INVALID_TOTP));
      return;
    }
  }

  next();
}
