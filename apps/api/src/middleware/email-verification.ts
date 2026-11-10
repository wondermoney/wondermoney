import type { NextFunction, Request, Response } from 'express';

import { aiRequiresVerifiedEmail } from '@service/auth/email-verification-policy';
import { ERROR_CODE, ForbiddenError } from '@utils/errors';

/** Whether this request's account may use the AI features (see `requireVerifiedEmailForAi`). */
export function canUseAi(req: Request): boolean {
  return !aiRequiresVerifiedEmail() || req.authUser?.user.emailVerified === true;
}

/**
 * Guards a route that spends money on a model call. When the server requires it
 * (`AI_REQUIRES_VERIFIED_EMAIL`), an account whose email is not verified gets 403
 * `email_verification_required`, which the apps answer with a "verify your email" prompt.
 */
export function requireVerifiedEmailForAi(req: Request, _res: Response, next: NextFunction): void {
  if (canUseAi(req)) {
    next();
    return;
  }
  throw new ForbiddenError('Verify your email address to use this feature.', ERROR_CODE.EMAIL_VERIFICATION_REQUIRED);
}
