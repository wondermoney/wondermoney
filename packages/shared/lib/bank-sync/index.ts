/**
 * The bank-sync failure vocabulary shared by the API, web and mobile.
 *
 * The API persists one of these codes on every failed or partial run
 * (`apps/api/src/services/bank-sync/bank-sync-status.service.ts`). Clients never
 * show the provider's message: they translate the code into a short, plain
 * sentence and offer the one action that can actually help.
 *
 * The message text lives in each app's translation files under the keys below,
 * so the same code reads naturally in every shipped locale. This module has no
 * dependencies so web and mobile can import it directly
 * (`@wondermoney/shared/bank-sync`).
 */

export const BANK_SYNC_ERROR_CODES = [
  'account_phase_failed',
  'authentication',
  'cancelled',
  'consent_expired',
  'data_validation',
  'institution_action_required',
  'institution_unavailable',
  'internal',
  'invalid_requisition',
  'provider_unavailable',
  'queue_unavailable',
  'rate_limited',
  'timeout',
  'transaction_phase_failed',
  'unknown',
  'unsupported_currency',
] as const;

export type BankSyncErrorCode = (typeof BANK_SYNC_ERROR_CODES)[number];

/**
 * What the person can do about a failed run. `fix-at-provider`: the problem is at the aggregator
 * (a bank inside SimpleFIN Bridge needs signing in again), so it is fixed there, not here.
 */
export type BankSyncErrorAction = 'contact-support' | 'fix-at-provider' | 'reconnect' | 'wait';

export interface BankSyncErrorCopy {
  action: BankSyncErrorAction;
  /** Translation key in the app's message catalog. */
  messageKey: string;
}

/**
 * One entry per code. `satisfies` makes a new code in the API a compile error
 * here until it gets plain copy and an action, which is the point: no run may
 * surface an untranslated or raw provider message.
 */
export const BANK_SYNC_ERROR_COPY = {
  account_phase_failed: {
    action: 'wait',
    messageKey: 'bank-sync.errors.account-phase-failed',
  },
  authentication: {
    action: 'reconnect',
    messageKey: 'bank-sync.errors.authentication',
  },
  cancelled: {
    action: 'reconnect',
    messageKey: 'bank-sync.errors.cancelled',
  },
  consent_expired: {
    action: 'reconnect',
    messageKey: 'bank-sync.errors.consent-expired',
  },
  data_validation: {
    action: 'contact-support',
    messageKey: 'bank-sync.errors.data-validation',
  },
  institution_action_required: {
    action: 'fix-at-provider',
    messageKey: 'bank-sync.errors.institution-action-required',
  },
  institution_unavailable: {
    action: 'wait',
    messageKey: 'bank-sync.errors.institution-unavailable',
  },
  internal: {
    action: 'contact-support',
    messageKey: 'bank-sync.errors.internal',
  },
  invalid_requisition: {
    action: 'reconnect',
    messageKey: 'bank-sync.errors.invalid-requisition',
  },
  provider_unavailable: {
    action: 'wait',
    messageKey: 'bank-sync.errors.provider-unavailable',
  },
  queue_unavailable: {
    action: 'wait',
    messageKey: 'bank-sync.errors.queue-unavailable',
  },
  rate_limited: {
    action: 'wait',
    messageKey: 'bank-sync.errors.rate-limited',
  },
  timeout: {
    action: 'wait',
    messageKey: 'bank-sync.errors.timeout',
  },
  transaction_phase_failed: {
    action: 'wait',
    messageKey: 'bank-sync.errors.transaction-phase-failed',
  },
  unknown: {
    action: 'contact-support',
    messageKey: 'bank-sync.errors.unknown',
  },
  unsupported_currency: {
    action: 'contact-support',
    messageKey: 'bank-sync.errors.unsupported-currency',
  },
} as const satisfies Record<BankSyncErrorCode, BankSyncErrorCopy>;

/** Translation key for the suggested action's label. */
export const BANK_SYNC_ERROR_ACTION_KEYS = {
  'contact-support': 'bank-sync.actions.contact-support',
  'fix-at-provider': 'bank-sync.actions.fix-at-provider',
  reconnect: 'bank-sync.actions.reconnect',
  wait: 'bank-sync.actions.wait',
} as const satisfies Record<BankSyncErrorAction, string>;

export function isBankSyncErrorCode(value: unknown): value is BankSyncErrorCode {
  return typeof value === 'string' && (BANK_SYNC_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * Copy for a code, falling back to `unknown` for a value this build does not
 * know — an older client must still say something honest about a newer run.
 */
export function bankSyncErrorCopy(code: null | string | undefined): BankSyncErrorCopy {
  return isBankSyncErrorCode(code) ? BANK_SYNC_ERROR_COPY[code] : BANK_SYNC_ERROR_COPY.unknown;
}
