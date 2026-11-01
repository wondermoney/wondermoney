import type { Request, Response } from 'express';

import { instanceName } from '@config/instance-name';
import { aiCapabilities } from '@service/ai/ai-provider';
import { resolveSignupMode } from '@service/auth/signup-policy';
import { isGoogleSignInConfigured } from '@service/auth/social-sign-in';
import { feedbackInbox, resolveEmailDriver, supportInbox } from '@service/email/email-transport';
import { isMarketDataEnabled } from '@service/market-data/eodhd.service';
import { resolveStorageConfig } from '@service/storage/s3';

/**
 * Public description of this server: what it is called, who may sign up, where to ask for help
 * and which optional features it has configured. Clients read it before sign-in, to hide what is not available and,
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
      // In-app feedback is emailed to SUPPORT_EMAIL, so it needs both an inbox and a real driver.
      feedback: feedbackInbox() !== null,
      fileStorage: resolveStorageConfig() !== null,
      googleSignIn: isGoogleSignInConfigured(),
      marketData: isMarketDataEnabled(),
    },
    minAppVersion: process.env['MIN_APP_VERSION']?.trim() || null,
    name: instanceName(),
    signupMode: resolveSignupMode(),
    // Shown to users as the place to ask for help; null hides support links.
    supportEmail: supportInbox(),
  });
}
