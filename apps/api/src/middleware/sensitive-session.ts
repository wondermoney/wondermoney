import type { NextFunction, Request, Response } from 'express';

import { createAuthFailureLimiter } from '@middleware/rate-limit';
import { verifyTotpForSession } from '@service/auth/better-auth';
import { SENSITIVE_SESSION_MAX_AGE_MS } from '@service/auth/sensitive-session-age';
import { ERROR_CODE, ForbiddenError, UnauthorizedError } from '@utils/errors';

export { SENSITIVE_SESSION_MAX_AGE_MS };

/** Wrong codes per person (5) and per address (30) in 15 minutes (`sensitiveTotpFailure*`). */
const totpFailuresPerPerson = createAuthFailureLimiter('sensitiveTotpFailure');
const totpFailuresPerAddress = createAuthFailureLimiter('sensitiveTotpFailureIp');

/** For tests: forget every counted wrong code. */
export async function resetSensitiveSessionTotpFailures(): Promise<void> {
  await Promise.all([totpFailuresPerPerson.reset(), totpFailuresPerAddress.reset()]);
}

/**
 * Gate a sensitive account action on a fresh session, plus TOTP when the user has it enabled.
 *
 * Personal API tokens are rejected outright: a token must never be able to create, list or
 * revoke tokens. The API-token scope allowlist already excludes `/v1/user`; this is the second,
 * explicit check at the route that owns token management.
 *
 * TOTP is revalidated through better-auth's own `/two-factor/verify-totp` endpoint
 * (`verifyTotpForSession`), which verifies the code against the stored secret and throws on a
 * wrong or expired one. The code arrives in `x-totp-code`, never in the URL. Called in-process,
 * that check passes no HTTP limiter, so wrong codes are counted here, per person and per address:
 * once either is over its budget, the request answers 429 with `Retry-After` before any code is
 * checked, right or wrong. A missing code is not counted, and a right one does not clear the count.
 */
export async function requireSensitiveSession(req: Request, res: Response, next: NextFunction): Promise<void> {
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
    const [person, address] = await Promise.all([totpFailuresPerPerson.check(req), totpFailuresPerAddress.check(req)]);
    const spent = [person, address].find((budget) => budget.overBudget);
    if (spent) {
      spent.refuse(res);
      return;
    }
    try {
      await verifyTotpForSession(req.headers, code);
    } catch {
      // Past either budget (a race of concurrent guesses), the failure itself answers 429.
      if (await person.failed(res) || await address.failed(res)) return;
      next(new ForbiddenError('That authenticator code is not valid.', ERROR_CODE.INVALID_TOTP));
      return;
    }
  }

  next();
}
