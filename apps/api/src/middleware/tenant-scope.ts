import type { NextFunction, Request, Response } from 'express';

import { InternalServerError } from '@utils/errors';
import logger from '@utils/logger';

/**
 * Fail-loud tenant-scope guard.
 *
 * Place on authed DATA routes, AFTER `resolveTenantForRequest`. The tenant filter
 * only engages once a tenant context is stamped onto the request EM; if an
 * authenticated request reaches a shared-data route without a resolved tenant
 * (e.g. a new route that forgot to wire `resolveTenantForRequest`), the filter
 * would silently be a no-op and could leak across household members. This guard
 * turns that mistake into a loud 500 instead of a silent leak.
 */
export function assertTenantResolved(req: Request, _res: Response, next: NextFunction): void {
  if (req.user && !req.tenant) {
    logger.error({ appuserKey: req.user.appuserKey, path: req.path }, 'Tenant scope not resolved on authed data route');
    next(new InternalServerError('Tenant scope not resolved'));
    return;
  }
  next();
}
