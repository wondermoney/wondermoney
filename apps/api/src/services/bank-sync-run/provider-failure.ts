import { BankProviderError, type BankReportedErrorCode, type ProviderErrorInfo, ProviderReportedError, RateLimitedError, RequestRejectedError, UnavailableError } from '@service/bank-providers/errors';

/**
 * Provider failure signals the sync phases read from a per-account error before they swallow it.
 *
 * The account and transaction phases catch every per-account error so one bad account does not
 * fail its siblings. Two kinds of error need more than that:
 *  - a rate limit (HTTP 429): every further call spends quota the bank has already refused, so the
 *    phase stops at the first one and reports it;
 *  - a rejection (HTTP 400 or 401) on every account: the usual sign that the bank ended the
 *    consent early. The worker then asks the provider for the session's status.
 *
 * Providers throw the typed errors from `bank-providers/errors.ts`; the `status` checks remain
 * for any legacy/raw error that still reaches here.
 */
export interface ProviderRateLimit {
  /** The provider's `Retry-After`, in seconds, when it sent one. */
  retryAfterSeconds?: number;
}

const REJECTION_STATUSES = new Set([400, 401]);

/** The rate limit an error carries, or undefined when the error is not a rate limit. */
export function providerRateLimitOf(error: unknown): ProviderRateLimit | undefined {
  if (error instanceof RateLimitedError) {
    return error.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: Math.ceil(error.retryAfterSeconds) };
  }
  if (statusOf(error) !== 429) return undefined;
  const retryAfter = (error as { retryAfter?: unknown }).retryAfter;
  return typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter >= 0
    ? { retryAfterSeconds: Math.ceil(retryAfter) }
    : {};
}

/** True when the provider rejected the request as invalid or unauthorized (HTTP 400 or 401). */
export function isProviderRejection(error: unknown): boolean {
  if (error instanceof BankProviderError && (error.status === 400 || error.status === 401)) return true;
  const status = statusOf(error);
  return status !== undefined && REJECTION_STATUSES.has(status);
}

/** The incident error code a typed provider failure maps to, when it is one. */
export function providerIncidentCodeOf(error: unknown): BankProviderError['incidentCode'] | undefined {
  return error instanceof BankProviderError ? error.incidentCode : undefined;
}

function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

/**
 * The code an aggregator reported for an account it answered for (`ProviderReportedError`), so
 * a partial run is recorded under what the aggregator said rather than a generic code.
 */
export function providerReportedCodeOf(error: unknown): BankReportedErrorCode | undefined {
  return error instanceof ProviderReportedError ? error.reportedCode : undefined;
}

/**
 * The code a failed balance fetch is recorded under when the sync can go on without it, or
 * undefined when the account has to fail as before.
 *
 * A balance the bank cannot give right now (an outage or timeout, `UnavailableError`) or refuses
 * to give (`RequestRejectedError`, e.g. a bank that answers 400 to every balances call) leaves the
 * account's last balance in place; its transactions still sync and the run is partial. A rate
 * limit, a lost consent, a credential the user must fix and an aggregator's own report keep their
 * meaning, so they still fail the account.
 */
export function skippableBalanceFailureCodeOf(error: unknown): BankReportedErrorCode | undefined {
  if (error instanceof RequestRejectedError) return 'institution_unavailable';
  if (error instanceof UnavailableError) return 'provider_unavailable';
  return undefined;
}

/** The aggregator's own code and message for a failed call, for logs. */
export function providerErrorInfoOf(error: unknown): ProviderErrorInfo | undefined {
  return error instanceof BankProviderError ? error.providerError : undefined;
}
