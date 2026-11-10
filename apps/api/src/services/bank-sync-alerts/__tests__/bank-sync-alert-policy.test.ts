import { describe, expect, it } from 'vitest';

import { EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';

import { type ConnectionHealth, decideBankSyncAlert } from '../bank-sync-alert-policy';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date('2026-11-09T09:00:00.000Z');

const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

function linked(overrides: Partial<ConnectionHealth> = {}): ConnectionHealth {
  return { accessValidUntil: at(90 * DAY), failureStreak: null, status: EnableBankingConnectionStatus.LINKED, ...overrides };
}

describe('decideBankSyncAlert', () => {
  it('says nothing about a healthy connection', () => {
    expect(decideBankSyncAlert(linked(), NOW)).toBeNull();
  });

  describe('a consent that is about to end', () => {
    it('warns once at about seven days and once within the last day, with a different event for each', () => {
      const validUntil = at(10 * DAY);
      const decisions = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((day) => decideBankSyncAlert(linked({ accessValidUntil: validUntil }), at(day * DAY)));
      const distinct = new Map(decisions.filter((d) => d !== null).map((d) => [`${d.event}:${d.episodeKey}`, d]));

      expect([...distinct.values()].map((d) => d.event)).toEqual(['consent_expiring_7d', 'consent_expiring_1d']);
      expect(decisions.slice(0, 3)).toEqual([null, null, null]);
    });

    it('starts the seven-day warning when seven days are left', () => {
      expect(decideBankSyncAlert(linked({ accessValidUntil: at(7 * DAY + HOUR) }), NOW)).toBeNull();
      expect(decideBankSyncAlert(linked({ accessValidUntil: at(7 * DAY) }), NOW)?.event).toBe('consent_expiring_7d');
      expect(decideBankSyncAlert(linked({ accessValidUntil: at(DAY + HOUR) }), NOW)?.event).toBe('consent_expiring_7d');
      expect(decideBankSyncAlert(linked({ accessValidUntil: at(DAY) }), NOW)?.event).toBe('consent_expiring_1d');
      expect(decideBankSyncAlert(linked({ accessValidUntil: at(HOUR) }), NOW)?.event).toBe('consent_expiring_1d');
    });

    it('says nothing once the consent has ended on its own date', () => {
      expect(decideBankSyncAlert(linked({ accessValidUntil: at(-HOUR) }), NOW)).toBeNull();
      expect(decideBankSyncAlert(linked({ accessValidUntil: at(-HOUR), status: EnableBankingConnectionStatus.EXPIRED }), NOW)).toBeNull();
    });

    it('treats a renewed consent as a new episode, so its warnings send again', () => {
      const first = decideBankSyncAlert(linked({ accessValidUntil: at(5 * DAY) }), NOW);
      const renewed = decideBankSyncAlert(linked({ accessValidUntil: at(185 * DAY) }), at(180 * DAY));

      expect(first?.event).toBe(renewed?.event);
      expect(first?.episodeKey).not.toBe(renewed?.episodeKey);
    });

    it('wins over a failing sync on the same connection', () => {
      const failing = { latestErrorCode: 'account_phase_failed', since: at(-5 * DAY) };
      expect(decideBankSyncAlert(linked({ accessValidUntil: at(3 * DAY), failureStreak: failing }), NOW)?.event).toBe('consent_expiring_7d');
    });
  });

  describe('a consent the bank ended early', () => {
    it('alerts straight away, keyed on the consent it ended', () => {
      const decision = decideBankSyncAlert(linked({ accessValidUntil: at(60 * DAY), status: EnableBankingConnectionStatus.EXPIRED }), NOW);
      expect(decision?.event).toBe('consent_revoked');
      expect(decideBankSyncAlert(linked({ accessValidUntil: at(60 * DAY), status: EnableBankingConnectionStatus.EXPIRED }), at(DAY))).toEqual(decision);
    });
  });

  describe('a scheduled sync that keeps failing', () => {
    it('alerts once the failures have lasted 48 hours, not before', () => {
      const streak = (sinceHoursAgo: number) => ({ latestErrorCode: 'account_phase_failed', since: at(-sinceHoursAgo * HOUR) });

      expect(decideBankSyncAlert(linked({ failureStreak: streak(47) }), NOW)).toBeNull();
      expect(decideBankSyncAlert(linked({ failureStreak: streak(48) }), NOW)?.event).toBe('sync_failing');
    });

    it('keeps one episode for the whole streak, so later runs do not alert again', () => {
      const failureStreak = { latestErrorCode: 'transaction_phase_failed', since: at(-3 * DAY) };
      const today = decideBankSyncAlert(linked({ failureStreak }), NOW);
      const tomorrow = decideBankSyncAlert(linked({ failureStreak: { ...failureStreak, latestErrorCode: 'invalid_requisition' } }), at(DAY));

      expect(tomorrow).toEqual(today);
    });

    it('starts a new episode after a success ends the streak', () => {
      const first = decideBankSyncAlert(linked({ failureStreak: { latestErrorCode: 'authentication', since: at(-3 * DAY) } }), NOW);
      const later = decideBankSyncAlert(linked({ failureStreak: { latestErrorCode: 'authentication', since: at(7 * DAY) } }), at(10 * DAY));

      expect(later?.event).toBe('sync_failing');
      expect(later?.episodeKey).not.toBe(first?.episodeKey);
    });

    it.each(['rate_limited', 'provider_unavailable', 'institution_unavailable', 'timeout', 'queue_unavailable', 'cancelled', 'internal', 'unknown', null])(
      'does not alert while the latest failure is transient or unexplained (%s)',
      (latestErrorCode) => {
        expect(decideBankSyncAlert(linked({ failureStreak: { latestErrorCode, since: at(-10 * DAY) } }), NOW)).toBeNull();
      },
    );

    it.each(['authentication', 'invalid_requisition', 'account_phase_failed', 'transaction_phase_failed', 'data_validation'])(
      'alerts when the latest failure needs the user (%s)',
      (latestErrorCode) => {
        expect(decideBankSyncAlert(linked({ failureStreak: { latestErrorCode, since: at(-10 * DAY) } }), NOW)?.event).toBe('sync_failing');
      },
    );

    it('says nothing about a connection that is not linked', () => {
      const failureStreak = { latestErrorCode: 'authentication', since: at(-10 * DAY) };
      for (const status of [EnableBankingConnectionStatus.CREATED, EnableBankingConnectionStatus.AUTHORIZED, EnableBankingConnectionStatus.ERROR]) {
        expect(decideBankSyncAlert(linked({ failureStreak, status }), NOW)).toBeNull();
      }
    });
  });
});
