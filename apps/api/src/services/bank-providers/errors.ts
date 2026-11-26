/**
 * Typed provider failures. A provider implementation throws one of these instead of leaking
 * its SDK's error shape, so the sync path and the incident record (issue #27's error codes)
 * never have to know which aggregator failed.
 *
 * The `status` values mirror the HTTP-ish signals the sync path already understood before the
 * interface existed (`provider-failure.ts` reads 429 as a rate limit and 400/401 as a
 * rejection), so Enable Banking's first implementation is behaviour-preserving.
 */
export type BankProviderIncidentCode = 'authentication' | 'consent_expired' | 'provider_unavailable' | 'rate_limited' | BankReportedErrorCode;

/**
 * What an aggregator can report about a run that otherwise answered: its own error list
 * (SimpleFIN's `errlist`), or an account the sync cannot take. Each is a code the clients
 * translate (`@wondermoney/shared/bank-sync`), never the aggregator's own text.
 */
export type BankReportedErrorCode = 'authentication' | 'institution_action_required' | 'institution_unavailable' | 'provider_unavailable' | 'rate_limited' | 'unsupported_currency';

/**
 * What the aggregator itself said about a failed call: its own error code and message, already
 * redacted by the provider implementation. For logs only; clients get the incident code.
 */
export interface ProviderErrorInfo {
  code?: string;
  message?: string;
  status?: number;
}

export class BankProviderError extends Error {
  /** The incident error code this failure maps to (`analytics/bank-sync-contract.ts`). */
  readonly incidentCode: BankProviderIncidentCode;
  /** The aggregator's own code and message for the call that failed, when it sent one. */
  providerError?: ProviderErrorInfo;
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

/**
 * The provider refused one request (an HTTP 400) for a reason that is not the consent: a bank
 * whose balances endpoint rejects every call, a parameter it does not accept. The connection is
 * fine and a reconnect does not help, so this is never an `authentication` failure. `status` stays
 * 400, so a rejection on every account still makes the worker ask the provider whether the consent
 * ended (`provider-failure.ts`).
 */
export class RequestRejectedError extends BankProviderError {
  constructor(message = 'The bank provider rejected the request', status = 400) {
    super(message, 'institution_unavailable', status);
  }
}

/** The provider is unreachable or returned a server error; retrying later may work. */
export class UnavailableError extends BankProviderError {
  constructor(message = 'Bank provider is temporarily unavailable') {
    super(message, 'provider_unavailable', 502);
  }
}

/**
 * The aggregator answered, but reported a problem with this account or with the bank behind it.
 * The sync phases count the account as failed and keep the code, so the run's history shows what
 * the aggregator said instead of a generic partial-sync code.
 */
export class ProviderReportedError extends BankProviderError {
  readonly reportedCode: BankReportedErrorCode;

  constructor(reportedCode: BankReportedErrorCode, message = 'The bank provider reported a problem with this account') {
    super(message, reportedCode, reportedCode === 'authentication' ? 400 : 502);
    this.reportedCode = reportedCode;
  }
}
