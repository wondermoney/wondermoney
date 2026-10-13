import type { NextFunction, Request, Response } from 'express';

import { DI } from '@app/app';
import { setTenantContext } from '@app/database/filters/tenant-filter';
import { Appuser } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import { authedUser } from '@middleware/authed-context';
import { ERROR } from '@utils/constants';
import { BadRequestError } from '@utils/errors';
import logger from '@utils/logger';

async function getTenantForRequest(req: Request) {
  const user = authedUser(req);
  const appuser = await DI.em.getRepository(Appuser).getUserById(user.appuserKey);
  if (!appuser) {
    logger.error(`Appuser not found for appuserKey: ${user.appuserKey}`);
    throw new BadRequestError(ERROR.AUTH.INVALID_USER);
  }

  const currentTenant = req.tenant;
  const appuserTenant = currentTenant
    ? await DI.em.getRepository(AppuserTenant).findOne({ appuserKey: appuser, tenantKey: currentTenant })
    : await DI.em.getRepository(AppuserTenant).getAppuserTenantByAppuser(appuser);
  if (!appuserTenant) {
    logger.error(`Tenant not found for appuserKey: ${appuser.appuserKey}`);
    throw new BadRequestError(ERROR.AUTH.INVALID_USER);
  }

  req.tenant = appuserTenant.tenantKey;
  return { appuser, tenant: appuserTenant.tenantKey };
}

/** Resolve `req.tenant` for the authenticated user and arm the tenant filter on the request EM. */
export async function resolveTenantForRequest(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.tenant) {
      await getTenantForRequest(req);
    }
    // RAD-343 (A2): stamp the tenant context onto the request EM so the global
    // tenant filter engages (scope-when-present). Without this the filter is a no-op.
    if (req.tenant && req.user) {
      setTenantContext(DI.em, { appuserKey: req.user.appuserKey, tenantKey: req.tenant.tenantKey });
    }
    next();
  } catch (error) {
    next(error);
  }
}
