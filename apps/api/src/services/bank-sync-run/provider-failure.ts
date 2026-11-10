/**
 * Provider failure signals the sync phases read from a per-account error before they swallow it.
 *
 * The account and transaction phases catch every per-account error so one bad account does not
 * fail its siblings. Two kinds of error need more than that:
 *  - a rate limit (HTTP 429): every further call spends quota the bank has already refused, so the
 *    phase stops at the first one and reports it;
 *  - a rejection (HTTP 400 or 401) on every account: the usual sign that the bank ended the
 *    consent early. The worker then asks the provider for the session's status.
 */
export interface ProviderRateLimit {
  /** The provider's `Retry-After`, in seconds, when it sent one. */
  retryAfterSeconds?: number;
}

const REJECTION_STATUSES = new Set([400, 401]);

/** The rate limit an error carries, or undefined when the error is not a rate limit. */
export function providerRateLimitOf(error: unknown): ProviderRateLimit | undefined {
  if (statusOf(error) !== 429) return undefined;
  const retryAfter = (error as { retryAfter?: unknown }).retryAfter;
  return typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter >= 0
    ? { retryAfterSeconds: Math.ceil(retryAfter) }
    : {};
}

/** True when the provider rejected the request as invalid or unauthorized (HTTP 400 or 401). */
export function isProviderRejection(error: unknown): boolean {
  const status = statusOf(error);
  return status !== undefined && REJECTION_STATUSES.has(status);
}

function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}
