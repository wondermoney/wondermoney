import { describe, expect, it } from 'vitest';

import { findPendingMatch, findPromotablePendingMatch } from '../pending-posted-match.service';

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

describe('findPendingMatch — loose pass', () => {
  const base = { currencyCode: 'EUR', transactionDate: new Date('2026-07-15T00:00:00.000Z') };
  const candidate = (counterparty: string, settlementAmount: number, transactionKey = 5) => ({ ...base, counterparty, settlementAmount, transactionKey });

  it.each([
    ['a tip added', 'CAFE CENTRAL LISBOA', -20, 'Cafe Central', -22, 2],
    ['an FX settlement', 'Hotel ABC', -100, 'Hotel ABC', -103.5, 3.5],
    ['AMZN Mktp to Amazon', 'AMZN Mktp US', -15, 'Amazon', -16.2, 1.2],
    ['a small absolute margin', 'Corner Shop', -2, 'Corner Shop', -2.5, 0.5],
  ])('promotes on %s', (_name, pendingCounterparty, pendingAmount, bookedCounterparty, bookedAmount, difference) => {
    const result = findPendingMatch(
      { ...base, counterparty: bookedCounterparty, settlementAmount: bookedAmount },
      [candidate(pendingCounterparty, pendingAmount)],
    );
    expect(result).toMatchObject({ amountDifference: difference, pass: 'loose', status: 'promote' });
  });

  it.each([
    ['a different merchant (amount alone is never enough)', 'Other Cafe', 'Cafe Central', -20, -22],
    ['an amount beyond 20% and the absolute margin', 'Cafe Central', 'Cafe Central', -20, -25],
    ['an opposite sign', 'Cafe Central', 'Cafe Central', -20, 22],
  ])('does not promote on %s', (_name, pendingCounterparty, bookedCounterparty, pendingAmount, bookedAmount) => {
    const result = findPendingMatch(
      { ...base, counterparty: bookedCounterparty, settlementAmount: bookedAmount },
      [candidate(pendingCounterparty, pendingAmount)],
    );
    expect(result.status).toBe('no_match');
  });

  it('does not promote across currencies', () => {
    const result = findPendingMatch(
      { ...base, counterparty: 'Cafe Central', currencyCode: 'USD', settlementAmount: -22 },
      [candidate('Cafe Central', -20)],
    );
    expect(result.status).toBe('no_match');
  });

  it('does not promote when the date is outside the window', () => {
    const result = findPendingMatch(
      { ...base, counterparty: 'Cafe Central', settlementAmount: -22, transactionDate: new Date('2026-07-25T00:00:00.000Z') },
      [candidate('Cafe Central', -20)],
    );
    expect(result.status).toBe('no_match');
  });

  it('refuses two loose candidates instead of guessing', () => {
    const result = findPendingMatch(
      { ...base, counterparty: 'Cafe Central', settlementAmount: -22 },
      [candidate('CAFE CENTRAL LISBOA', -20, 5), candidate('CAFE CENTRAL PORTO', -21, 6)],
    );
    expect(result).toMatchObject({ pass: 'loose', status: 'ambiguous' });
  });

  it('prefers the exact pass when the amount matches', () => {
    const result = findPendingMatch(
      { ...base, counterparty: 'Cafe Central', settlementAmount: -20 },
      [candidate('CAFE CENTRAL LISBOA', -20)],
    );
    expect(result).toMatchObject({ amountDifference: 0, pass: 'exact', status: 'promote' });
  });

  it('does not fall through to the loose pass when the exact pass is ambiguous', () => {
    const result = findPendingMatch(
      { ...base, counterparty: 'Cafe Central', settlementAmount: -20 },
      [candidate('CAFE CENTRAL LISBOA', -20, 5), candidate('CAFE CENTRAL PORTO', -20, 6)],
    );
    expect(result).toMatchObject({ pass: 'exact', status: 'ambiguous' });
  });
});
