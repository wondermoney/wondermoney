import { EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';

/** How close to its end a consent has to be before the user is asked to reconnect. */
const CONSENT_EXPIRING_WINDOW_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Where an Enable Banking connection's consent stands. `state` is one of:
 *  - `pending`: the user has not finished the bank's consent flow yet;
 *  - `active`: linked, with more than {@link CONSENT_EXPIRING_WINDOW_DAYS} days left;
 *  - `expiring`: linked, ending within that window;
 *  - `expired`: the consent reached its end date;
 *  - `revoked`: the bank ended the consent before its end date. The sync worker marks a
 *    connection `EXPIRED` only after Enable Banking confirms the session is no longer
 *    authorized (`EnableBankingConnectionSyncState.checkConsent`), so an `EXPIRED` row whose
 *    `accessValidUntil` is still in the future is exactly that case;
 *  - `error`: the link failed, or a linked row has no usable end date.
 */
export interface EnableBankingConsent {
  /** Whole days until the consent ends; 0 once it has ended; null when there is no end date yet. */
  daysUntilExpiry: null | number;
  state: EnableBankingConsentState;
}

export type EnableBankingConsentState = 'active' | 'error' | 'expired' | 'expiring' | 'pending' | 'revoked';

interface ConsentInput {
  accessValidUntil?: Date | null;
  status: EnableBankingConnectionStatus;
}

export function enableBankingConsentOf(connection: ConsentInput, now: Date = new Date()): EnableBankingConsent {
  const validUntil = validDate(connection.accessValidUntil);
  switch (connection.status) {
    case EnableBankingConnectionStatus.AUTHORIZED:
    case EnableBankingConnectionStatus.CREATED:
      return { daysUntilExpiry: null, state: 'pending' };
    case EnableBankingConnectionStatus.EXPIRED:
      return { daysUntilExpiry: 0, state: validUntil && validUntil.getTime() > now.getTime() ? 'revoked' : 'expired' };
    case EnableBankingConnectionStatus.LINKED: {
      if (!validUntil) return { daysUntilExpiry: null, state: 'error' };
      const daysUntilExpiry = daysUntil(validUntil, now);
      if (validUntil.getTime() <= now.getTime()) return { daysUntilExpiry, state: 'expired' };
      if (validUntil.getTime() - now.getTime() <= CONSENT_EXPIRING_WINDOW_DAYS * DAY_MS) return { daysUntilExpiry, state: 'expiring' };
      return { daysUntilExpiry, state: 'active' };
    }
    case EnableBankingConnectionStatus.ERROR:
    default:
      return { daysUntilExpiry: null, state: 'error' };
  }
}

/** Whole days from `now` until `date`, never negative; null when `date` is missing or invalid. */
export function daysUntil(date: Date | null | undefined, now: Date = new Date()): null | number {
  const valid = validDate(date);
  if (!valid) return null;
  return Math.max(0, Math.floor((valid.getTime() - now.getTime()) / DAY_MS));
}

function validDate(date: Date | null | undefined): Date | undefined {
  if (!date || Number.isNaN(date.getTime())) return undefined;
  return date;
}
