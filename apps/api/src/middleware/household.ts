import type { NextFunction, Request, Response } from 'express';

import { pathMatches } from '@middleware/api-token-policy';
import { householdCan } from '@service/household/household-permissions';
import { ERROR_CODE, ForbiddenError, UnauthorizedError } from '@utils/errors';

interface PersonalWrite {
  method: 'DELETE' | 'PATCH' | 'POST' | 'PUT';
  mount: string;
  path: string;
}

/**
 * Household management routes (invites, role changes, removals) for owners and admins. Whether
 * the caller may act on one particular invite or member is the service's call (`householdCan`
 * with the target's role). Place after `resolveTenantForRequest`, which sets `req.householdRole`.
 */
export function requireHouseholdManager(req: Request, _res: Response, next: NextFunction): void {
  if (!req.tenant || !req.user) {
    next(new UnauthorizedError('Authentication required'));
    return;
  }
  if (!householdCan(req.householdRole, 'manage')) {
    next(new ForbiddenError('Only the household owner or an admin can manage the household.', ERROR_CODE.HOUSEHOLD_ROLE_REQUIRED));
    return;
  }
  next();
}

/** Owner-only household routes (transferring ownership). */
export function requireHouseholdOwner(req: Request, _res: Response, next: NextFunction): void {
  if (!req.tenant || !req.user) {
    next(new UnauthorizedError('Authentication required'));
    return;
  }
  if (!householdCan(req.householdRole, 'transferOwnership')) {
    next(new ForbiddenError('Only the household owner can do this.', ERROR_CODE.HOUSEHOLD_OWNER_REQUIRED));
    return;
  }
  next();
}

/**
 * The writes a viewer keeps: their own account, settings, devices and credentials, never the
 * household's shared data. Everything else that is not a GET answers 403 `household_read_only`.
 * `household-viewer-policy.test.ts` walks every mounted router and fails when a write route is
 * added that is neither blocked nor listed here.
 */
export const VIEWER_PERSONAL_WRITES: readonly PersonalWrite[] = [
  // The assistant reads the household; its conversations, consent and dismissed drafts are the
  // viewer's own. Applying a proposal changes shared data, so it is not here.
  { method: 'POST', mount: '/v1/assistant', path: '/chat' },
  { method: 'POST', mount: '/v1/assistant', path: '/consent' },
  { method: 'POST', mount: '/v1/assistant', path: '/disable' },
  { method: 'POST', mount: '/v1/assistant', path: '/proposals/:proposalId/reject' },

  { method: 'POST', mount: '/v1/feedback', path: '/' },

  // A watchlist belongs to one person.
  { method: 'PUT', mount: '/v1/financial-markets', path: '/watchlist/:symbol' },
  { method: 'DELETE', mount: '/v1/financial-markets', path: '/watchlist/:symbol' },

  // Leaving (the service allows a viewer only themself) and joining another household.
  { method: 'DELETE', mount: '/v1/household', path: '/members/:appuserKey' },
  { method: 'POST', mount: '/v1/household', path: '/invites/:token/accept' },

  { method: 'DELETE', mount: '/v1/user', path: '/me' },
  { method: 'POST', mount: '/v1/user', path: '/api-tokens' },
  { method: 'DELETE', mount: '/v1/user', path: '/api-tokens/:id' },
  { method: 'POST', mount: '/v1/user', path: '/calendar-feed-token' },
  { method: 'DELETE', mount: '/v1/user', path: '/calendar-feed-token' },
  { method: 'POST', mount: '/v1/user', path: '/pairing-codes' },
  { method: 'DELETE', mount: '/v1/user', path: '/devices/:sessionId' },
  { method: 'PATCH', mount: '/v1/user', path: '/me/email-notification-preferences' },
  { method: 'PATCH', mount: '/v1/user', path: '/me/push-preferences' },
  { method: 'POST', mount: '/v1/user', path: '/me/push-devices' },
  { method: 'DELETE', mount: '/v1/user', path: '/me/push-devices/:token' },
  { method: 'POST', mount: '/v1/user', path: '/me/push-test' },
  { method: 'PATCH', mount: '/v1/user', path: '/me/preferences' },
  // An export reads the household; it changes nothing in it.
  { method: 'POST', mount: '/v1/user', path: '/me/exports' },
  { method: 'POST', mount: '/v1/user', path: '/me/onboarding/complete' },
  // Removing their own Enable Banking credential; adding one is for linking banks, a shared write.
  { method: 'DELETE', mount: '/v1/user', path: '/enable-banking-credential' },
  { method: 'PATCH', mount: '/v1/user', path: '/:userId' },
  { method: 'POST', mount: '/v1/user', path: '/:userId/onboarding/:step/complete' },
];

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Whether a viewer may make this request: every read, and the personal writes above. */
export function viewerMayRequest(mount: string, method: string, path: string): boolean {
  const normalisedMethod = method.toUpperCase();
  if (READ_METHODS.has(normalisedMethod)) return true;
  const normalisedMount = mount.length > 1 && mount.endsWith('/') ? mount.slice(0, -1) : mount;
  return VIEWER_PERSONAL_WRITES.some(
    (route) => route.method === normalisedMethod && route.mount === normalisedMount && pathMatches(route.path, path),
  );
}

export const HOUSEHOLD_READ_ONLY_MESSAGE = 'You have view-only access to this household.';

/**
 * Viewers read the household's shared data and change none of it. Part of `authedTenant`, after
 * `resolveTenantForRequest`, so every authenticated data mount — session or personal API token —
 * gets the same answer.
 */
export function blockViewerWrite(req: Request, _res: Response, next: NextFunction): void {
  // No resolved role is treated like a viewer: fail closed.
  if (householdCan(req.householdRole, 'writeSharedData')) {
    next();
    return;
  }
  if (viewerMayRequest(req.baseUrl, req.method, req.path)) {
    next();
    return;
  }
  next(new ForbiddenError(HOUSEHOLD_READ_ONLY_MESSAGE, ERROR_CODE.HOUSEHOLD_READ_ONLY));
}
