import defaults from './defaults.json';

/**
 * The Enable Banking Control Panel values a server hands out by default, for registering a
 * person's own application (`GET /v1/instance`'s `enableBankingSetup`). The API serves them, the
 * web setup wizard copies them, and the bank setup guide quotes them. They live in
 * `defaults.json` so the docs check (`apps/docs/scripts/check-enable-banking-values.mjs`) can read
 * them too, and fail when the guide drifts from them.
 */

/** WonderMoney's privacy policy, which a person registering an application for personal use can point at. */
export const ENABLE_BANKING_DEFAULT_PRIVACY_URL: string = defaults.privacyUrl;

/** WonderMoney's terms of service, likewise. */
export const ENABLE_BANKING_DEFAULT_TERMS_URL: string = defaults.termsUrl;

/** Where Enable Banking sends the browser back to, on the API's own address. */
export const ENABLE_BANKING_CALLBACK_PATH: string = defaults.callbackPath;
