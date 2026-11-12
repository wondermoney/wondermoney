import type { Request, Response } from 'express';

import { getBearerToken } from '@middleware/auth-helpers';
import { isApiTokenShaped } from '@service/api-token/api-token.service';
import { signInToDemo } from '@service/auth/demo-sign-in.service';
import { ERROR_CODE, ForbiddenError, NotFoundError, ServiceUnavailableError } from '@utils/errors';
import logger from '@utils/logger';

/**
 * `POST /v1/auth/demo` — public. Sign in to the shared read-only demo account, no password.
 *
 * 404 unless the instance set `DEMO_SIGN_IN_ENABLED`, so a server that never opted in looks like
 * one without the route. The response sets the session cookie, like a password sign-in, and also
 * returns it in the body in the shape of `POST /v1/auth/pair`, so the mobile app adopts it the same
 * way. The demo's session is no secret worth guarding: anyone can have one.
 *
 * A personal API token is refused: a script has no business minting browser sessions.
 */
export async function demoSignIn(req: Request, res: Response) {
  if (isApiTokenShaped(getBearerToken(req.headers.authorization))) {
    throw new ForbiddenError('An API token cannot sign in to the demo.', ERROR_CODE.API_TOKEN_SCOPE_REQUIRED);
  }

  const result = await signInToDemo();
  if (result.status === 'disabled') throw new NotFoundError();
  if (result.status === 'unavailable') {
    // The operator enabled the demo, so a refusal here is a setup problem they need to see.
    logger.warn({ reason: result.reason }, 'Demo sign-in refused: the demo account is not usable');
    throw new ServiceUnavailableError('The demo is not available right now.', ERROR_CODE.DEMO_UNAVAILABLE);
  }

  const { session } = result;
  res.cookie(session.cookieName, decodeURIComponent(session.cookieValue), {
    ...session.cookieAttributes,
    expires: session.expiresAt,
  });
  return res.status(201).json({
    session: {
      cookieName: session.cookieName,
      cookieValue: session.cookieValue,
      expiresAt: session.expiresAt,
    },
  });
}
