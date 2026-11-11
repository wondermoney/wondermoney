import type { NextFunction, Request, Response } from 'express';

import { isAiAllowedFor, isAiHidden } from '@service/ai/ai-availability';
import type { AiFeature } from '@service/ai/ai-provider';
import { ERROR_CODE, FeatureDisabledError, ForbiddenError } from '@utils/errors';

const FEATURE_LABEL: Record<AiFeature, string> = {
  assistant: 'The assistant',
  csvMapping: 'AI column mapping',
  enrichment: 'Transaction enrichment',
  monthlyStory: 'The monthly story',
  ocr: 'Receipt scanning',
};

/**
 * Refuses an AI route for a person who hid AI, before any model call or allowance spend.
 *
 * Two different refusals, because clients act on them differently: a person who turned AI off
 * gets 403 `feature_disabled` (their own choice, restoring the switch re-enables it), while a
 * server with no provider keeps the existing 501 `feature_disabled` (nothing the person can do).
 * Mount it after `requireVerifiedEmailForAi` and before `requireAiAllowance`, so a refused
 * request spends nothing.
 */
export function requireAiAllowed(feature: AiFeature) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const appuser = req.user;
    if (!appuser || isAiAllowedFor(appuser, feature)) {
      next();
      return;
    }
    if (isAiHidden(appuser)) {
      throw new ForbiddenError(`${FEATURE_LABEL[feature]} is turned off for this account.`, ERROR_CODE.FEATURE_DISABLED);
    }
    throw new FeatureDisabledError(FEATURE_LABEL[feature]);
  };
}
