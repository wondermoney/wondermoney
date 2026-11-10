import { describe, expect, it } from 'vitest';

import type { RateTable } from '@service/currency/exchange-rate';

import { historyInViewerCurrency, historyRatePairs } from '../portfolio-history-currency';

/** A rate table holding `rates[from>to]` as a list of [effective date, rate], latest on or before wins. */
function rateTable(rates: Record<string, [string, number][]>): RateTable {
  return {
    rateOn(from, to, date) {
      if (from === to) return 1;
      const found = (rates[`${from}>${to}`] ?? [])
        .filter(([day]) => new Date(`${day}T00:00:00Z`).getTime() <= date.getTime())
        .at(-1);
      return found?.[1] ?? null;
    },
  };
}

describe('portfolio history in the viewer\'s currency', () => {
  it('converts each member\'s snapshot into the viewer\'s currency before adding them', () => {
    const rates = rateTable({ 'USD>EUR': [['2026-01-01', 0.8]] });

    const history = historyInViewerCurrency([
      { currencyCode: 'EUR', date: '2026-03-02', value: 1000 },
      { currencyCode: 'USD', date: '2026-03-02', value: 500 },
      { currencyCode: 'EUR', date: '2026-03-03', value: 1100 },
      { currencyCode: 'USD', date: '2026-03-03', value: 600 },
    ], 'EUR', rates);

    expect(history).toEqual({
      dataPoints: [{ date: '2026-03-02', value: 1400 }, { date: '2026-03-03', value: 1580 }],
      incompleteDates: [],
    });
  });

  it('converts each day at the rate in force at the end of that day', () => {
    const rates = rateTable({ 'USD>EUR': [['2026-03-01', 0.8], ['2026-03-03', 0.9]] });

    const history = historyInViewerCurrency([
      { currencyCode: 'USD', date: '2026-03-02', value: 100 },
      { currencyCode: 'USD', date: '2026-03-03', value: 100 },
    ], 'EUR', rates);

    expect(history.dataPoints).toEqual([{ date: '2026-03-02', value: 80 }, { date: '2026-03-03', value: 90 }]);
  });

  it('leaves a member out of a day with no rate and flags that day, never adding at face value', () => {
    const rates = rateTable({ 'USD>EUR': [['2026-03-03', 0.8]] });

    const history = historyInViewerCurrency([
      { currencyCode: 'EUR', date: '2026-03-02', value: 1000 },
      { currencyCode: 'USD', date: '2026-03-02', value: 500 },
      { currencyCode: 'EUR', date: '2026-03-03', value: 1000 },
      { currencyCode: 'USD', date: '2026-03-03', value: 500 },
    ], 'EUR', rates);

    expect(history).toEqual({
      dataPoints: [{ date: '2026-03-02', value: 1000 }, { date: '2026-03-03', value: 1400 }],
      incompleteDates: ['2026-03-02'],
    });
  });

  it('drops a day none of whose snapshots can be converted, and flags it', () => {
    const history = historyInViewerCurrency([
      { currencyCode: 'USD', date: '2026-03-02', value: 500 },
      { currencyCode: 'EUR', date: '2026-03-03', value: 1000 },
    ], 'EUR', rateTable({}));

    expect(history).toEqual({ dataPoints: [{ date: '2026-03-03', value: 1000 }], incompleteDates: ['2026-03-02'] });
  });

  it('treats a snapshot whose currency is unknown as unconvertible', () => {
    const history = historyInViewerCurrency([
      { currencyCode: 'EUR', date: '2026-03-02', value: 1000 },
      { currencyCode: null, date: '2026-03-02', value: 500 },
    ], 'EUR', rateTable({}));

    expect(history).toEqual({ dataPoints: [{ date: '2026-03-02', value: 1000 }], incompleteDates: ['2026-03-02'] });
  });

  it('returns the days in date order whatever order the snapshots come in', () => {
    const history = historyInViewerCurrency([
      { currencyCode: 'EUR', date: '2026-03-03', value: 2 },
      { currencyCode: 'EUR', date: '2026-03-02', value: 1 },
    ], 'EUR', rateTable({}));

    expect(history.dataPoints.map((point) => point.date)).toEqual(['2026-03-02', '2026-03-03']);
  });

  it('asks for a rate from every other currency the snapshots are in, and none for the viewer\'s own', () => {
    const pairs = historyRatePairs([
      { currencyCode: 'EUR', date: '2026-03-02', value: 1 },
      { currencyCode: 'USD', date: '2026-03-02', value: 1 },
      { currencyCode: 'USD', date: '2026-03-03', value: 1 },
      { currencyCode: null, date: '2026-03-03', value: 1 },
    ], 'EUR');

    expect(pairs).toEqual([{ from: 'USD', to: 'EUR' }]);
  });
});
