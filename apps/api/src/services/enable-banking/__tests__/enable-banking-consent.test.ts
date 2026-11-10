import { describe, expect, it } from 'vitest';

import { EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';

import { enableBankingConsentOf } from '../enable-banking-consent';

const NOW = new Date('2026-07-31T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const inDays = (days: number) => new Date(NOW.getTime() + days * DAY);

describe('enableBankingConsentOf', () => {
  it('reads a linked consent with more than 14 days left as active', () => {
    expect(enableBankingConsentOf({ accessValidUntil: inDays(30), status: EnableBankingConnectionStatus.LINKED }, NOW)).toEqual({ daysUntilExpiry: 30, state: 'active' });
  });

  it('reads a linked consent with exactly 14 days left as expiring', () => {
    expect(enableBankingConsentOf({ accessValidUntil: inDays(14), status: EnableBankingConnectionStatus.LINKED }, NOW)).toEqual({ daysUntilExpiry: 14, state: 'expiring' });
  });

  it('counts whole days left, so a consent ending later today has 0 days', () => {
    expect(enableBankingConsentOf({ accessValidUntil: new Date(NOW.getTime() + 3 * 60 * 60 * 1000), status: EnableBankingConnectionStatus.LINKED }, NOW)).toEqual({ daysUntilExpiry: 0, state: 'expiring' });
  });

  it('reads a linked consent past its end date as expired', () => {
    expect(enableBankingConsentOf({ accessValidUntil: inDays(-1), status: EnableBankingConnectionStatus.LINKED }, NOW)).toEqual({ daysUntilExpiry: 0, state: 'expired' });
  });

  it('reads an expired connection whose consent had time left as revoked by the bank', () => {
    expect(enableBankingConsentOf({ accessValidUntil: inDays(90), status: EnableBankingConnectionStatus.EXPIRED }, NOW)).toEqual({ daysUntilExpiry: 0, state: 'revoked' });
  });

  it('reads an expired connection past its end date as expired, not revoked', () => {
    expect(enableBankingConsentOf({ accessValidUntil: inDays(-3), status: EnableBankingConnectionStatus.EXPIRED }, NOW)).toEqual({ daysUntilExpiry: 0, state: 'expired' });
  });

  it('reads an expired connection with no end date as expired', () => {
    expect(enableBankingConsentOf({ accessValidUntil: null, status: EnableBankingConnectionStatus.EXPIRED }, NOW).state).toBe('expired');
  });

  it('has no expiry while the connection is still being set up', () => {
    expect(enableBankingConsentOf({ accessValidUntil: null, status: EnableBankingConnectionStatus.CREATED }, NOW)).toEqual({ daysUntilExpiry: null, state: 'pending' });
    expect(enableBankingConsentOf({ accessValidUntil: null, status: EnableBankingConnectionStatus.AUTHORIZED }, NOW)).toEqual({ daysUntilExpiry: null, state: 'pending' });
  });

  it('reads a failed link, or a linked connection without an end date, as an error', () => {
    expect(enableBankingConsentOf({ accessValidUntil: null, status: EnableBankingConnectionStatus.ERROR }, NOW).state).toBe('error');
    expect(enableBankingConsentOf({ accessValidUntil: null, status: EnableBankingConnectionStatus.LINKED }, NOW).state).toBe('error');
    expect(enableBankingConsentOf({ accessValidUntil: new Date('nope'), status: EnableBankingConnectionStatus.LINKED }, NOW).state).toBe('error');
  });
});
