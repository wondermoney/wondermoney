import type { NextFunction, Request, Response } from 'express';

import { DI } from '@app/database/di';
import { type AllowanceFeature, spendAiAllowance } from '@service/ai/ai-allowance.service';
import { ERROR_CODE, ForbiddenError } from '@utils/errors';

/**
 * Charges one call against the household's daily allowance for `feature` (see
 * `ai-allowance.service.ts`), or answers 403 `ai_allowance_exhausted` once it is used up. A 403,
 * not a 429: the web client retries every 429 automatically, and this one will not clear for hours.
 * Mount it after `requireVerifiedEmailForAi`, so a refused account spends nothing.
 */
export function requireAiAllowance(feature: AllowanceFeature) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const tenantKey = req.tenant?.tenantKey;
    if (tenantKey === undefined) throw new ForbiddenError('No household for this request.');
    if (!(await spendAiAllowance(DI.em, tenantKey, feature))) {
      throw new ForbiddenError("Today's allowance for this feature is used up. It resets at midnight UTC.", ERROR_CODE.AI_ALLOWANCE_EXHAUSTED);
    }
    next();
  };
}
