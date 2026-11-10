import { createHash } from 'node:crypto';

import { BankSyncAlertEventType } from '@entity/BankSyncAlertDelivery';
import type { ConnectionHealthRow } from '@service/bank-sync-alerts/bank-sync-alert-health.repository';
import { type BankSyncAlertEvent, decideBankSyncAlert } from '@service/bank-sync-alerts/bank-sync-alert-policy';
import { daysUntil } from '@service/enable-banking/enable-banking-consent';
import { encodeEnableBankingInstitutionId } from '@utils/enable-banking-institution-id';

/** The in-app banner's view of a bank sync alert (`GET /v1/banking/alerts`). */
export interface InAppBankSyncAlertDto {
  /** The id `GET /v1/banking/bank/:bankId/start` takes to connect this bank again. */
  bankId: null | string;
  /** Whole days until the consent ends (`consent_expiring`). */
  daysUntilExpiry: null | number;
  /** When the consent ends (`consent_expiring`). */
  expiresAt: null | string;
  /** The first failed sync of the streak (`sync_failing`). */
  failingSince: null | string;
  /** Opaque and stable for one alert episode and stage: clients key dismissals on it. */
  id: string;
  institutionName: null | string;
  kind: 'consent_expiring' | 'consent_revoked' | 'sync_failing';
}

const KIND: Record<BankSyncAlertEvent, InAppBankSyncAlertDto['kind']> = {
  [BankSyncAlertEventType.CONSENT_EXPIRING_1D]: 'consent_expiring',
  [BankSyncAlertEventType.CONSENT_EXPIRING_7D]: 'consent_expiring',
  [BankSyncAlertEventType.CONSENT_REVOKED]: 'consent_revoked',
  [BankSyncAlertEventType.SYNC_FAILING]: 'sync_failing',
};

/** The same decisions the emails are sent from, as banner rows. */
export function toInAppBankSyncAlerts(connections: readonly ConnectionHealthRow[], now: Date): InAppBankSyncAlertDto[] {
  const alerts: InAppBankSyncAlertDto[] = [];
  for (const connection of connections) {
    const decision = decideBankSyncAlert(connection, now);
    if (!decision) continue;
    const kind = KIND[decision.event];
    const name = connection.aspspName.trim();
    alerts.push({
      bankId: connection.aspspCountry && name ? encodeEnableBankingInstitutionId({ country: connection.aspspCountry, name }) : null,
      daysUntilExpiry: kind === 'consent_expiring' ? daysUntil(connection.accessValidUntil, now) : null,
      expiresAt: kind === 'consent_expiring' ? (connection.accessValidUntil?.toISOString() ?? null) : null,
      failingSince: kind === 'sync_failing' ? (connection.failureStreak?.since.toISOString() ?? null) : null,
      id: createHash('sha256').update(`${connection.enableBankingConnectionKey}:${decision.event}:${decision.episodeKey}`).digest('hex').slice(0, 16),
      institutionName: name || null,
      kind,
    });
  }
  return alerts;
}
