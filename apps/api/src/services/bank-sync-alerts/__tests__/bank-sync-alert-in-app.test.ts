import { describe, expect, it } from 'vitest';

import { EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';

import type { ConnectionHealthRow } from '../bank-sync-alert-health.repository';
import { toInAppBankSyncAlerts } from '../bank-sync-alert-in-app';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-09T09:00:00.000Z');
const at = (days: number) => new Date(NOW.getTime() + days * DAY);

function row(overrides: Partial<ConnectionHealthRow> = {}): ConnectionHealthRow {
  return {
    accessValidUntil: at(90), appuserKey: 1, aspspCountry: 'PT', aspspName: 'Banco Exemplo', enableBankingConnectionKey: 7,
    failureStreak: null, status: EnableBankingConnectionStatus.LINKED, tenantKey: 3, ...overrides,
  };
}

describe('toInAppBankSyncAlerts', () => {
  it('lists only the connections that need the user, in the shape clients render', () => {
    const alerts = toInAppBankSyncAlerts([
      row(),
      row({ accessValidUntil: at(5), enableBankingConnectionKey: 8 }),
      row({ enableBankingConnectionKey: 9, failureStreak: { latestErrorCode: 'authentication', since: at(-3) } }),
      row({ accessValidUntil: at(40), enableBankingConnectionKey: 10, status: EnableBankingConnectionStatus.EXPIRED }),
    ], NOW);

    expect(alerts).toEqual([
      { bankId: expect.any(String), daysUntilExpiry: 5, expiresAt: at(5).toISOString(), failingSince: null, id: expect.any(String), institutionName: 'Banco Exemplo', kind: 'consent_expiring' },
      { bankId: expect.any(String), daysUntilExpiry: null, expiresAt: null, failingSince: at(-3).toISOString(), id: expect.any(String), institutionName: 'Banco Exemplo', kind: 'sync_failing' },
      { bankId: expect.any(String), daysUntilExpiry: null, expiresAt: null, failingSince: null, id: expect.any(String), institutionName: 'Banco Exemplo', kind: 'consent_revoked' },
    ]);
  });

  it('keeps an alert\'s id for its whole episode and changes it for the last-day stage, so a dismissal holds until then', () => {
    const connection = row({ accessValidUntil: at(5) });
    const idAt = (days: number) => toInAppBankSyncAlerts([connection], at(days))[0]?.id;

    expect(idAt(0)).toBe(idAt(3));
    expect(idAt(4.5)).not.toBe(idAt(3));
    expect(idAt(0)).not.toBe(toInAppBankSyncAlerts([row({ accessValidUntil: at(5), enableBankingConnectionKey: 8 })], NOW)[0]?.id);
  });

  it('does not expose internal keys in the id', () => {
    const [alert] = toInAppBankSyncAlerts([row({ accessValidUntil: at(5) })], NOW);
    expect(alert?.id).toMatch(/^[0-9a-f]{16}$/u);
  });
});
