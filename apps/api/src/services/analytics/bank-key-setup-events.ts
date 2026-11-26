import { createHmac } from 'node:crypto';

import type { AnalyticsEventProperties } from '@wondermoney/shared';

import { loadAuthConfiguration } from '@config/configuration';
import { ERROR_CODE } from '@utils/errors';

export type BankKeyActivationFailureReason = AnalyticsEventProperties<'bank_key_activation_failed'>['reason'];

/** The API's own error codes for a refused activation, as the catalogue's `reason`. */
const REASON_OF_CODE: Readonly<Record<string, BankKeyActivationFailureReason>> = {
  [ERROR_CODE.BAD_GATEWAY]: 'provider_unavailable',
  [ERROR_CODE.ENABLE_BANKING_APPLICATION_NOT_ACTIVATED]: 'application_not_activated',
  [ERROR_CODE.ENABLE_BANKING_APPLICATION_NOT_FOUND]: 'application_not_found',
  [ERROR_CODE.ENABLE_BANKING_APPLICATION_SANDBOX]: 'application_sandbox',
  [ERROR_CODE.ENABLE_BANKING_CREDENTIAL_REFUSED]: 'credential_refused',
  [ERROR_CODE.ENABLE_BANKING_PENDING_CREDENTIAL_MISSING]: 'pending_credential_missing',
  [ERROR_CODE.GATEWAY_TIMEOUT]: 'provider_unavailable',
  [ERROR_CODE.SERVICE_UNAVAILABLE]: 'provider_unavailable',
  [ERROR_CODE.TOO_MANY_REQUESTS]: 'rate_limited',
};

/**
 * Why activating a pending Enable Banking key failed, as one of the catalogue's fixed codes: the
 * code of the error the activate route answers (`enable-banking-application-check.ts`), or how the
 * Enable Banking client mapped a rate limit or an outage. Never the provider's message.
 */
export function bankKeyActivationFailureReason(error: unknown): BankKeyActivationFailureReason {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  return (typeof code === 'string' && Object.hasOwn(REASON_OF_CODE, code) && REASON_OF_CODE[code]) || 'unknown';
}

/**
 * The event id of an event about one generated key (`bank_key_activated`,
 * `bank_key_setup_abandoned`): one per key. The credential's key is sequential, so a plain hash of
 * it could be reversed by hashing every small number; this is an HMAC with the auth secret
 * (`BETTER_AUTH_SECRET`, which the API and the worker share), as `mcpOAuthHouseholdReference`
 * keys a household, so whoever sees the id cannot recover the key without that secret. The
 * development fallback is the same one; the API refuses to start without the secret in production.
 */
export function bankKeyEventId(
  event: 'bank_key_activated' | 'bank_key_setup_abandoned',
  enableBankingCredentialKey: number,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const secret = loadAuthConfiguration(env).betterAuthSecret ?? 'wondermoney-development-secret';
  const digest = createHmac('sha256', secret).update(`enable-banking-credential:${enableBankingCredentialKey}`).digest('hex');
  return `${event}.v1:${digest}`;
}
