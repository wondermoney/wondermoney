import type { RequestHandler } from 'express';

import { requireAuth } from '@middleware/auth';
import { blockDemoMutation } from '@middleware/demo';
import { productDataRateLimit } from '@middleware/rate-limit';
import { resolveTenantForRequest } from '@middleware/tenant';
import { assertTenantResolved } from '@middleware/tenant-scope';
import { getUser } from '@middleware/user';

/**
 * Named middleware stacks for the authorization model.
 *
 * RAD-audit: this was fourteen verbatim copies of the same seven-element array, in the
 * highest-churn file in the repo (46 commits/6 months). The drift that predicts was already
 * measurable — five of twenty-six mounts deviated, and `/v1/operations` had silently lost
 * tenant scoping entirely, making it the only authed data mount where the fail-loud
 * `assertTenantResolved` invariant did not hold.
 *
 * Expressing the stacks once means a deviation is now a visible, deliberate choice at the
 * call site rather than a diff nobody reads.
 *
 * `authedTenant` — authenticated, tenant resolved and asserted, demo writes blocked.
 */
export const authedTenant = (limiter: () => RequestHandler = productDataRateLimit): RequestHandler[] => [
  requireAuth,
  limiter(),
  getUser,
  resolveTenantForRequest,
  assertTenantResolved,
  blockDemoMutation,
];

/**
 * `authedTenant` without `blockDemoMutation`.
 *
 * Used only by `/v1/operations`, whose routes are read-only status polls that the demo
 * account must be able to perform. Named here rather than assembled inline at the mount so
 * the omission is a deliberate, greppable choice rather than something that reads like the
 * drift this module exists to prevent.
 */
export const readOnlyTenantGated = (limiter: () => RequestHandler = productDataRateLimit): RequestHandler[] => [
  requireAuth,
  limiter(),
  getUser,
  resolveTenantForRequest,
  assertTenantResolved,
];
