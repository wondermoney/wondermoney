import type { Request, Response } from 'express';

import { enabledCryptoChains } from '@config/crypto-explorers';
import { isDemoSignInEnabled } from '@config/demo';
import { instanceName } from '@config/instance-name';
import { isMcpEnabled } from '@config/mcp';
import { isPushEnabled } from '@config/push';
import { statementImportLimits } from '@config/statement-import';
import { aiCapabilities, aiProviderLabel } from '@service/ai/ai-provider';
import { signInMethods } from '@service/auth/oidc-provider';
import { passkeyRelyingParty } from '@service/auth/passkey';
import { resolveSignupMode } from '@service/auth/signup-policy';
import { isGoogleSignInConfigured } from '@service/auth/social-sign-in';
import { bankSyncFeatures } from '@service/bank-providers/registry';
import { feedbackInbox, resolveEmailDriver, supportInbox } from '@service/email/email-transport';
import { isMarketDataEnabled, marketDataFeatures } from '@service/market-data/registry';
import { resolveStorageConfig } from '@service/storage/s3';
import { buildInfo, FRONTEND_URL } from '@utils/constants';

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
  const market = marketDataFeatures();
  const statementProvider = aiProviderLabel('statementImport');
  return res.json({
    apiVersion: 1,
    commit,
    features: {
      ai: aiCapabilities(),
      bankSync: bankSync.bankSync,
      // `instance` when the operator set an instance-wide Enable Banking credential, `user` when
      // each user adds their own. Whether the caller's household may use the instance one is on
      // the signed-in profile (`GET /v1/user/me/profile`, `bankSyncCredentials`).
      bankSyncCredentials: bankSync.bankSyncCredentials,
      /** The providers this instance enabled through `BANK_PROVIDERS`. */
      bankSyncProviders: bankSync.bankSyncProviders,
      contactForm: supportInbox() !== null,
      // Crypto wallets from public addresses: the chains whose block explorer the operator set
      // (`CRYPTO_BTC_EXPLORER_URL`, `CRYPTO_ETH_EXPLORER_URL`). Empty: off.
      cryptoWalletChains: enabledCryptoChains(),
      // One-click sign-in to the shared read-only demo (`POST /v1/auth/demo`, `DEMO_SIGN_IN_ENABLED`).
      demo: isDemoSignInEnabled(),
      // False when mail only goes to the log.
      email: resolveEmailDriver() !== 'log',
      // In-app feedback is emailed to SUPPORT_EMAIL, so it needs both an inbox and a real driver.
      feedback: feedbackInbox() !== null,
      fileStorage: resolveStorageConfig() !== null,
      googleSignIn: isGoogleSignInConfigured(),
      marketData: isMarketDataEnabled(),
      /** What the market-data providers here can be asked (`search`, `quote`, `dailyHistory`, `dividends`, `splits`). */
      marketDataCapabilities: market.marketDataCapabilities,
      /** The set-up providers, in the order `MARKET_DATA_PROVIDERS` asks them. */
      marketDataProviders: market.marketDataProviders,
      // The read-only MCP server at `POST /v1/mcp` (`MCP_ENABLED`, on by default).
      mcp: isMcpEnabled(),
      // Single sign-on through the operator's OIDC provider: "Sign in with <name>". Null when off.
      oidc: signIn.oidc,
      // Passkey sign-in on the web app (better-auth's passkey plugin, always on, OIDC_ONLY too).
      passkey: true,
      // The hostname passkeys belong to (the web app's, from `APP_URL`). The mobile app offers
      // passkeys only when its build lists this hostname among its associated domains.
      passkeyRpId: passkeyRelyingParty(FRONTEND_URL).rpID,
      // False under OIDC_ONLY: the server refuses password sign-in, sign-up and reset.
      passwordSignIn: signIn.passwordSignIn,
      // Mobile push notifications through the Expo push service (`PUSH_ENABLED`, off by default).
      push: isPushEnabled(),
      // PDF statement import: the largest PDF it takes and the provider's family. Null when no
      // model for it is configured. This document is public, so it never names the provider's
      // address; signed-in clients read the provider's name from `GET /v1/user/me/profile`.
      statementImport: statementProvider ? { ...statementImportLimits(), providerKind: statementProvider.kind } : null,
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
