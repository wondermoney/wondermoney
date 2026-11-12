import type { NextFunction, Request, Response } from 'express';

import { DI } from '@app/app';
import { Appuser, AppuserAccountType } from '@entity/Appuser';
import { adminAuth } from '@middleware/auth';
import { getBearerToken } from '@middleware/auth-helpers';
import { isApiTokenShaped } from '@service/api-token/api-token.service';
import { getAuthSession } from '@service/auth/better-auth';
import { NotFoundError } from '@utils/errors';
import logger from '@utils/logger';

/**
 * The gate for admin endpoints a person reads from the web app (`/v1/admin/bank-sync`).
 *
 * Two credentials get through:
 *  - the admin API key (`x-api-key`, `ADMIN_API_KEY`), for scripts: checked by `adminAuth`
 *    exactly as on the rest of `/v1/admin`, including its 401 for a wrong key;
 *  - a signed-in session whose app user is an instance admin (`Appuser.accountType` admin, from
 *    `OIDC_ADMIN_GROUPS` or the `instance-admin` script). A session exists only once two-factor
 *    sign-in has completed, so an admin with TOTP has passed it.
 *
 * Everything else is a 404, the same answer as a path that does not exist, so a non-admin
 * cannot tell the endpoint is there: no session, a regular or demo account, and a personal API
 * token (`wm_pat_`) whatever its scopes, even one belonging to an admin. A token is a machine
 * credential for the person's own data, never for the instance.
 */
export async function requireInstanceAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.headers['x-api-key'] !== undefined) {
    adminAuth(req, res, next);
    return;
  }
  if (isApiTokenShaped(getBearerToken(req.get('authorization')))) {
    next(new NotFoundError());
    return;
  }
  try {
    const session = await getAuthSession(req.headers);
    if (!session) {
      next(new NotFoundError());
      return;
    }
    const appuser = await DI.em.findOne(Appuser, { deletedAt: undefined, externalUserId: session.user.id, recordActive: true });
    if (appuser?.accountType !== AppuserAccountType.ADMIN) {
      next(new NotFoundError());
      return;
    }
    req.authUser = session;
    req.user = appuser;
    next();
  } catch (error) {
    logger.error(`Instance admin check failed: ${error}`);
    next(new NotFoundError());
  }
}
