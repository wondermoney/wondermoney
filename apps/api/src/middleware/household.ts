import type { NextFunction, Request, Response } from 'express';

import { ERROR_CODE, ForbiddenError, UnauthorizedError } from '@utils/errors';

/**
 * RAD-343 (B1) — owner-only guard for household management (invite/revoke/resend).
 * Place after resolveTenantForRequest. Members can view the household (GET) but only
 * the tenant owner may manage invites.
 */
export function requireHouseholdOwner(req: Request, _res: Response, next: NextFunction): void {
  const { tenant, user } = req;
  if (!tenant || !user) {
    next(new UnauthorizedError('Authentication required'));
    return;
  }
  // ownerAppuserKey is a (possibly unloaded) reference; its PK is accessible without a query.
  const ownerAppuserKey = (tenant.ownerAppuserKey as unknown as undefined | { appuserKey: number })?.appuserKey;
  if (ownerAppuserKey !== user.appuserKey) {
    next(new ForbiddenError('Only the household owner can manage the household.', ERROR_CODE.HOUSEHOLD_OWNER_REQUIRED));
    return;
  }
  next();
}
