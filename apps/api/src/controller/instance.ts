import type { Request, Response } from 'express';

import { aiCapabilities } from '@service/ai/ai-provider';
import { resolveSignupMode } from '@service/auth/signup-policy';
import { resolveEmailDriver, supportInbox } from '@service/email/email-transport';
import { isMarketDataEnabled } from '@service/market-data/eodhd.service';
import { resolveStorageConfig } from '@service/storage/s3';

/**
 * Public description of this server: what it is called, who may sign up and which optional
 * features it has configured. Clients read it before sign-in, to hide what is not available and,
 * on mobile, to check that a self-hosted server URL is a WonderMoney API at all.
 *
 * Bump `apiVersion` on a breaking change to the client contract; `MIN_APP_VERSION` lets an
 * operator tell older mobile builds to update.
 */
export function getInstance(_req: Request, res: Response) {
  return res.json({
    apiVersion: 1,
    features: {
      ai: aiCapabilities(),
      // Enable Banking is bring-your-own-key: each user adds their own credentials.
      bankSync: true,
      contactForm: supportInbox() !== null,
      // False when mail only goes to the log.
      email: resolveEmailDriver() !== 'log',
      fileStorage: resolveStorageConfig() !== null,
      marketData: isMarketDataEnabled(),
    },
    minAppVersion: process.env['MIN_APP_VERSION']?.trim() || null,
    name: process.env['INSTANCE_NAME']?.trim() || 'WonderMoney',
    signupMode: resolveSignupMode(),
  });
}
