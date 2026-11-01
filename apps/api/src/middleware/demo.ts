import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { AppuserAccountType } from '@entity/Appuser';
import { TenantType } from '@entity/Tenant';
import { ERROR_CODE } from '@utils/errors';

/** Re-exported for the existing consumers; the source of truth is `ERROR_CODE`. */
export const DEMO_READ_ONLY_CODE = ERROR_CODE.DEMO_READ_ONLY;
export const DEMO_READ_ONLY_MESSAGE = 'The demo account is read-only. Create an account to save changes.';

const DEMO_MUTATION_METHODS = new Set(['DELETE', 'PATCH', 'POST', 'PUT']);

export function blockDemoMutation(req: Request, res: Response, next: NextFunction): Response | void {
  if (!isDemoRequest(req) || !DEMO_MUTATION_METHODS.has(req.method)) {
    next();
    return;
  }

  return blockDemoResponse(res);
}

export function blockDemoStateChange(req: Request, res: Response, next: NextFunction): Response | void {
  if (!isDemoRequest(req)) {
    next();
    return;
  }

  return blockDemoResponse(res);
}

export function isDemoRequest(req: Request): boolean {
  return (
    req.user?.accountType === AppuserAccountType.DEMO ||
    req.tenant?.tenantType === TenantType.DEMO
  );
}

function blockDemoResponse(res: Response): Response {
  return res.status(StatusCodes.FORBIDDEN).json({ code: DEMO_READ_ONLY_CODE, message: DEMO_READ_ONLY_MESSAGE });
}

