import type { Request, Response } from 'express';

import { instanceName } from '@config/instance-name';
import { isMcpEnabled } from '@config/mcp';
import { aiCapabilities } from '@service/ai/ai-provider';
import { signInMethods } from '@service/auth/oidc-provider';
import { resolveSignupMode } from '@service/auth/signup-policy';
import { isGoogleSignInConfigured } from '@service/auth/social-sign-in';
import { bankSyncFeatures } from '@service/bank-providers/registry';
import { feedbackInbox, resolveEmailDriver, supportInbox } from '@service/email/email-transport';
import { isMarketDataEnabled } from '@service/market-data/eodhd.service';
import { resolveStorageConfig } from '@service/storage/s3';
import { buildInfo } from '@utils/constants';

/**
 * Public description of this server: what it is called, who may sign up, where to ask for help
 * and which optional features it has configured. Clients read it before sign-in, to hide what is not available and,
 * on mobile, to check that a self-hosted server URL is a WonderMoney API at all.
 *
 * Bump `apiVersion` on a breaking change to the client contract; `MIN_APP_VERSION` lets an
 * operator tell older mobile builds to update. `version` and `commit` say which build the server
 * runs (`dev` and null for a local build).
 */
export function getInstance(_req: Request, res: Response) {
  const { commit, version } = buildInfo();
  const bankSync = bankSyncFeatures();
  const signIn = signInMethods();
  return res.json({
    apiVersion: 1,
    commit,
    features: {
      ai: aiCapabilities(),
      // Enable Banking is bring-your-own-key: each user adds their own credentials.
      bankSync: bankSync.bankSync,
      /** The providers this instance enabled through `BANK_PROVIDERS`. */
      bankSyncProviders: bankSync.bankSyncProviders,
      contactForm: supportInbox() !== null,
      // False when mail only goes to the log.
      email: resolveEmailDriver() !== 'log',
      // In-app feedback is emailed to SUPPORT_EMAIL, so it needs both an inbox and a real driver.
      feedback: feedbackInbox() !== null,
      fileStorage: resolveStorageConfig() !== null,
      googleSignIn: isGoogleSignInConfigured(),
      marketData: isMarketDataEnabled(),
      // The read-only MCP server at `POST /v1/mcp` (`MCP_ENABLED`, on by default).
      mcp: isMcpEnabled(),
      // Single sign-on through the operator's OIDC provider: "Sign in with <name>". Null when off.
      oidc: signIn.oidc,
      // Passkey sign-in on the web app (better-auth's passkey plugin, always on, OIDC_ONLY too).
      passkey: true,
      // False under OIDC_ONLY: the server refuses password sign-in, sign-up and reset.
      passwordSignIn: signIn.passwordSignIn,
    },
    minAppVersion: process.env['MIN_APP_VERSION']?.trim() || null,
    name: instanceName(),
    signupMode: resolveSignupMode(),
    // Where users can chip in towards running this instance (`SPONSOR_URL`); null hides the link.
    sponsorUrl: process.env['SPONSOR_URL']?.trim() || null,
    // Shown to users as the place to ask for help; null hides support links.
    supportEmail: supportInbox(),
    version,
  });
}
