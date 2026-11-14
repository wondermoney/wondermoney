import { describe, expect, it } from 'vitest';

import { RecurringAmountType } from '@service/recurring/recurring-types';

import { forecastOccurrenceAmount, projectBalanceForecast } from '../balance-forecast.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const from = day('2026-03-01');

const account = (overrides: Partial<{ accountKey: number; balance: null | number; currency: string }> = {}) => ({
  accountKey: 1,
  balance: 1000,
  currency: 'EUR',
  ...overrides,
});

const occurrence = (overrides: Partial<{ accountKey: null | number; amount: null | number; currency: null | string; date: Date; name: string; seriesKey: number }> = {}) => ({
  accountKey: 1,
  amount: 100,
  currency: 'EUR',
  date: day('2026-03-06'),
  name: 'Rent',
  seriesKey: 10,
  ...overrides,
});

describe('projectBalanceForecast', () => {
  it('returns one point per day, applies an occurrence on its day and finds the low point', () => {
    const forecast = projectBalanceForecast({ accounts: [account()], days: 30, from, occurrences: [occurrence()] });

    expect(forecast.from).toBe('2026-03-01');
    expect(forecast.days).toBe(30);
    expect(forecast.accounts).toHaveLength(1);
    const series = forecast.accounts[0]!;
    expect(series.points).toHaveLength(30);
    expect(series.points[0]).toEqual({ balance: 1000, date: '2026-03-01' });
    expect(series.points[4]).toEqual({ balance: 1000, date: '2026-03-05' });
    expect(series.points[5]).toEqual({ balance: 900, date: '2026-03-06' });
    expect(series.points.at(-1)).toEqual({ balance: 900, date: '2026-03-30' });
    expect(series.lowPoint).toEqual({ balance: 900, date: '2026-03-06' });
    expect(series.projected).toEqual([
      { accountKey: 1, amount: 100, currency: 'EUR', date: '2026-03-06', name: 'Rent', seriesKey: 10 },
    ]);
    expect(series.complete).toBe(true);
  });

  it('keeps each account in its own currency and reports the total per currency, never one mixed figure', () => {
    const forecast = projectBalanceForecast({
      accounts: [account({ accountKey: 1, balance: 1000, currency: 'EUR' }), account({ accountKey: 2, balance: 500, currency: 'USD' })],
      days: 30,
      from,
      occurrences: [
        occurrence({ accountKey: 1, amount: 100, currency: 'EUR', date: day('2026-03-06'), name: 'Rent', seriesKey: 10 }),
        occurrence({ accountKey: 2, amount: 50, currency: 'USD', date: day('2026-03-07'), name: 'Phone', seriesKey: 11 }),
      ],
    });

    expect(forecast.accounts.map((series) => [series.currency, series.lowPoint])).toEqual([
      ['EUR', { balance: 900, date: '2026-03-06' }],
      ['USD', { balance: 450, date: '2026-03-07' }],
    ]);
    expect(forecast.totals.map((total) => [total.currency, total.openingBalance, total.lowPoint])).toEqual([
      ['EUR', 1000, { balance: 900, date: '2026-03-06' }],
      ['USD', 500, { balance: 450, date: '2026-03-07' }],
    ]);
    expect(forecast.total).toBeNull();
  });

  it('counts a series without an account toward the total only', () => {
    const forecast = projectBalanceForecast({
      accounts: [account()],
      days: 30,
      from,
      occurrences: [occurrence({ accountKey: null })],
    });

    expect(forecast.accounts[0]!.points.every((point) => point.balance === 1000)).toBe(true);
    expect(forecast.accounts[0]!.projected).toEqual([]);
    expect(forecast.totals[0]!.lowPoint).toEqual({ balance: 900, date: '2026-03-06' });
    expect(forecast.totals[0]!.projected).toHaveLength(1);
    expect(forecast.total).toBe(forecast.totals[0]);
  });

  it('applies an occurrence before the window on its first day and ignores one after it', () => {
    const forecast = projectBalanceForecast({
      accounts: [account()],
      days: 30,
      from,
      occurrences: [
        occurrence({ date: day('2026-02-20'), name: 'Overdue', seriesKey: 1 }),
        occurrence({ date: day('2026-04-15'), name: 'Later', seriesKey: 2 }),
      ],
    });

    expect(forecast.accounts[0]!.points[0]).toEqual({ balance: 900, date: '2026-03-01' });
    expect(forecast.accounts[0]!.projected.map((item) => item.name)).toEqual(['Overdue']);
  });

  it('keeps an account with no balance out of the series and marks it incomplete', () => {
    const forecast = projectBalanceForecast({ accounts: [account({ balance: null })], days: 30, from, occurrences: [occurrence()] });

    expect(forecast.accounts[0]).toMatchObject({ complete: false, lowPoint: null, openingBalance: null, points: [], projected: [] });
    expect(forecast.totals[0]).toMatchObject({ complete: false, lowPoint: null, openingBalance: null, points: [] });
    expect(forecast.total).toBe(forecast.totals[0]);
  });

  it('leaves out an occurrence whose currency cannot be attributed to the account', () => {
    const forecast = projectBalanceForecast({
      accounts: [account()],
      days: 30,
      from,
      occurrences: [occurrence({ currency: 'USD' })],
    });

    expect(forecast.accounts[0]!.points.every((point) => point.balance === 1000)).toBe(true);
    expect(forecast.accounts[0]!.complete).toBe(false);
    expect(forecast.totals[0]!.complete).toBe(false);
  });

  it('reports the first day of the lowest plateau as the low point', () => {
    const forecast = projectBalanceForecast({
      accounts: [account()],
      days: 30,
      from,
      occurrences: [occurrence({ amount: 100, date: day('2026-03-06'), name: 'Rent', seriesKey: 1 })],
    });

    // 900 is the balance from the 6th to the end of the window; the callout names the day it starts.
    expect(forecast.accounts[0]!.lowPoint).toEqual({ balance: 900, date: '2026-03-06' });
  });
});

describe('forecastOccurrenceAmount', () => {
  it('uses a variable bill\'s average and a fixed bill\'s expected amount', () => {
    expect(forecastOccurrenceAmount({ amountType: RecurringAmountType.variable, averageAmount: 80, expectedAmount: 50 })).toBe(80);
    expect(forecastOccurrenceAmount({ amountType: RecurringAmountType.fixed, averageAmount: 30, expectedAmount: 40 })).toBe(40);
  });

  it('falls back to the other amount and then to null', () => {
    expect(forecastOccurrenceAmount({ amountType: RecurringAmountType.variable, averageAmount: null, expectedAmount: 50 })).toBe(50);
    expect(forecastOccurrenceAmount({ amountType: RecurringAmountType.fixed, averageAmount: 30, expectedAmount: null })).toBe(30);
    expect(forecastOccurrenceAmount({ amountType: RecurringAmountType.fixed, averageAmount: null, expectedAmount: null })).toBeNull();
  });
});
