import { BankSyncAlertEventType } from '@entity/BankSyncAlertDelivery';
import { EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';

/**
 * What a bank connection needs the user to know, and when. This module only decides; it sends
 * nothing. Every channel reads the same decision: the email sweep (`bank-sync-alert.service.ts`),
 * the in-app banner (`GET /v1/banking/alerts`), and a push channel once mobile push exists.
 *
 * - `consent_expiring_7d` / `consent_expiring_1d`: the consent ends within 7 days / within a day.
 * - `consent_revoked`: the bank ended the consent before its end date (the sync worker marks the
 *   connection `EXPIRED` only after Enable Banking confirms the session is no longer authorized).
 * - `sync_failing`: scheduled syncs have failed for at least 48 hours and the latest failure is one
 *   the user can act on. Transient failures (rate limits, a bank or provider outage, timeouts, our
 *   own errors) never alert on their own: they clear up without the user.
 *
 * A connection has at most one alert at a time; the consent alerts win, since reconnecting fixes a
 * failing sync too. `episodeKey` identifies the occurrence: the consent's end date, or the start
 * of the failure streak. A delivery is deduplicated on (connection, event, episode), so a renewed
 * consent or a new failure streak alerts again, and the same one never does.
 */

export interface BankSyncAlertDecision {
  episodeKey: string;
  event: BankSyncAlertEvent;
}

export type BankSyncAlertEvent = BankSyncAlertEventType;

export interface ConnectionHealth {
  accessValidUntil: Date | null;
  /** Final failed scheduled syncs since the connection last synced successfully, if any. */
  failureStreak: null | {
    /** The error code of the most recent failure (`analytics/bank-sync-contract.ts` codes). */
    latestErrorCode: null | string;
    /** When the first failure after the last success happened. */
    since: Date;
  };
  status: EnableBankingConnectionStatus;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const CONSENT_EXPIRING_FIRST_WARNING_MS = 7 * DAY_MS;
const CONSENT_EXPIRING_LAST_WARNING_MS = DAY_MS;
const SYNC_FAILING_AFTER_MS = 48 * HOUR_MS;

/**
 * Failure codes that clear up without the user, so they never alert by themselves. A code not
 * listed here (authentication, invalid_requisition, account_phase_failed, ...) is one reconnecting
 * or fixing the bank key can solve. `unknown` and a missing code are treated as transient: an alert
 * should not ask the user to act on a failure nobody has classified.
 */
const TRANSIENT_ERROR_CODES: ReadonlySet<string> = new Set([
  'cancelled',
  'institution_unavailable',
  'internal',
  'provider_unavailable',
  'queue_unavailable',
  'rate_limited',
  'timeout',
  'unknown',
]);

export function decideBankSyncAlert(health: ConnectionHealth, now: Date): BankSyncAlertDecision | null {
  const validUntil = health.accessValidUntil;
  if (!validUntil || Number.isNaN(validUntil.getTime())) return null;
  const remaining = validUntil.getTime() - now.getTime();
  if (remaining <= 0) return null;
  const consentEpisode = validUntil.toISOString();

  if (health.status === EnableBankingConnectionStatus.EXPIRED) return { episodeKey: consentEpisode, event: BankSyncAlertEventType.CONSENT_REVOKED };
  if (health.status !== EnableBankingConnectionStatus.LINKED) return null;

  if (remaining <= CONSENT_EXPIRING_LAST_WARNING_MS) return { episodeKey: consentEpisode, event: BankSyncAlertEventType.CONSENT_EXPIRING_1D };
  if (remaining <= CONSENT_EXPIRING_FIRST_WARNING_MS) return { episodeKey: consentEpisode, event: BankSyncAlertEventType.CONSENT_EXPIRING_7D };

  const streak = health.failureStreak;
  if (!streak || isTransientSyncError(streak.latestErrorCode)) return null;
  if (now.getTime() - streak.since.getTime() < SYNC_FAILING_AFTER_MS) return null;
  return { episodeKey: streak.since.toISOString(), event: BankSyncAlertEventType.SYNC_FAILING };
}

function isTransientSyncError(code: null | string | undefined): boolean {
  return !code || TRANSIENT_ERROR_CODES.has(code);
}
