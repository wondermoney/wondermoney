import { describe, expect, it } from 'vitest';

import { findPromotablePendingMatch } from '../pending-posted-match.service';

const booked = {
  counterparty: 'acme',
  currencyCode: 'EUR',
  settlementAmount: -20,
  transactionDate: new Date('2026-07-15T00:00:00.000Z'),
};
const pending = (over: Partial<typeof booked> & { transactionKey: number }) => ({ ...booked, ...over });

describe('findPromotablePendingMatch', () => {
  it('promotes the single pending row that matches amount, currency, counterparty and date window', () => {
    const candidate = pending({ transactionDate: new Date('2026-07-13T00:00:00.000Z'), transactionKey: 5 });
    const result = findPromotablePendingMatch(booked, [candidate]);
    expect(result).toEqual({ pending: candidate, status: 'promote' });
  });

  it('does not match when the signed amount differs', () => {
    expect(findPromotablePendingMatch(booked, [pending({ settlementAmount: -21, transactionKey: 5 })]).status).toBe('no_match');
  });

  it('does not match across currencies', () => {
    expect(findPromotablePendingMatch(booked, [pending({ currencyCode: 'USD', transactionKey: 5 })]).status).toBe('no_match');
  });

  it('does not match when the date is outside the ±5 day window', () => {
    expect(findPromotablePendingMatch(booked, [pending({ transactionDate: new Date('2026-07-25T00:00:00.000Z'), transactionKey: 5 })]).status).toBe('no_match');
  });

  it('does not match when the counterparty differs (both present)', () => {
    expect(findPromotablePendingMatch(booked, [pending({ counterparty: 'other', transactionKey: 5 })]).status).toBe('no_match');
  });

  it('treats amounts equal to the currency minor unit as matching (rounds to 2dp)', () => {
    const candidate = pending({ settlementAmount: -20.004, transactionKey: 5 });
    expect(findPromotablePendingMatch(booked, [candidate]).status).toBe('promote');
  });

  it('refuses to promote when more than one pending row matches (ambiguous — never guess with money)', () => {
    const a = pending({ transactionKey: 5 });
    const b = pending({ transactionKey: 6 });
    const result = findPromotablePendingMatch(booked, [a, b]);
    expect(result.status).toBe('ambiguous');
    expect(result.status === 'ambiguous' && result.candidates).toEqual([a, b]);
  });

  it('returns no_match for an empty pending set', () => {
    expect(findPromotablePendingMatch(booked, []).status).toBe('no_match');
  });

  it('honours a custom date window', () => {
    const candidate = pending({ transactionDate: new Date('2026-07-25T00:00:00.000Z'), transactionKey: 5 });
    expect(findPromotablePendingMatch(booked, [candidate], { dateWindowDays: 15 }).status).toBe('promote');
  });
});
