/**
 * Typed provider failures. A provider implementation throws one of these instead of leaking
 * its SDK's error shape, so the sync path and the incident record (issue #27's error codes)
 * never have to know which aggregator failed.
 *
 * The `status` values mirror the HTTP-ish signals the sync path already understood before the
 * interface existed (`provider-failure.ts` reads 429 as a rate limit and 400/401 as a
 * rejection), so Enable Banking's first implementation is behaviour-preserving.
 */
export type BankProviderIncidentCode = 'authentication' | 'consent_expired' | 'provider_unavailable' | 'rate_limited';

export class BankProviderError extends Error {
  /** The incident error code this failure maps to (`analytics/bank-sync-contract.ts`). */
  readonly incidentCode: BankProviderIncidentCode;
  /** HTTP-ish status the legacy classifiers read. */
  readonly status: number;

  constructor(message: string, incidentCode: BankProviderIncidentCode, status: number) {
    super(message);
    this.name = new.target.name;
    this.incidentCode = incidentCode;
    this.status = status;
    Error.captureStackTrace(this, new.target);
  }
}

/** The provider refused the call because a quota was exhausted. */
export class RateLimitedError extends BankProviderError {
  /** The provider's `Retry-After`, in seconds, when it sent one. */
  readonly retryAfterSeconds?: number;

  constructor(message = 'Bank provider rate limit reached', retryAfterSeconds?: number) {
    super(message, 'rate_limited', 429);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** The bank ended the consent; the user must reconnect. */
export class ConsentExpiredError extends BankProviderError {
  constructor(message = 'Bank consent has ended') {
    super(message, 'consent_expired', 401);
  }
}

/** The user must do something (re-enter a credential, re-authorize) before a retry can work. */
export class UserActionRequiredError extends BankProviderError {
  constructor(message = 'The bank provider needs the user to act') {
    super(message, 'authentication', 400);
  }
}

/** The provider is unreachable or returned a server error; retrying later may work. */
export class UnavailableError extends BankProviderError {
  constructor(message = 'Bank provider is temporarily unavailable') {
    super(message, 'provider_unavailable', 502);
  }
}
