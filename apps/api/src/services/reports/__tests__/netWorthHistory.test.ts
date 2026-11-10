import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReportFilters } from '@validators/reports';

import type { ReportServiceInput } from '../report-filters';

const mocks = vi.hoisted(() => ({ getNetWorthHistory: vi.fn() }));

vi.mock('@service/net-worth/net-worth.service', () => ({
  default: { getNetWorthHistory: mocks.getNetWorthHistory },
}));

import { buildNetWorthHistoryCsv, getNetWorthHistoryReport } from '../netWorthHistory.service';
import { REPORT_DEFAULT_TIME_ZONE } from '../report-months';

describe('buildNetWorthHistoryCsv', () => {
  it('flattens the breakdown into dotted columns with 2-decimal amounts', () => {
    const csv = buildNetWorthHistoryCsv([
      { breakdown: { assets: 1600, liabilities: 100 }, date: '2026-07-01T00:00:00.000Z', netWorth: 1500 },
    ]);

    expect(csv).toBe('﻿date,netWorth,assets,liabilities\n2026-07-01T00:00:00.000Z,1500.00,1600.00,100.00\n');
  });
});

/**
 * `fromDate` arrives as an instant (clients serialise through
 * `toISOString()`), but a history point is a floating `YYYY-MM-DD` calendar
 * month. Reading the instant's month in UTC let a point from the month *before*
 * the selected period clear the filter.
 */
describe('getNetWorthHistoryReport period filtering', () => {
  const makeInput = (overrides: Partial<ReportFilters> = {}): ReportServiceInput =>
    ({
      filters: { includePending: false, includeTransfers: false, timezone: REPORT_DEFAULT_TIME_ZONE, ...overrides },
      tenant: { tenantKey: 113 },
      user: { appuserKey: 71 },
    }) as unknown as ReportServiceInput;

  const givenPoints = (...dates: string[]) => {
    mocks.getNetWorthHistory.mockResolvedValue({
      points: dates.map((date) => ({ accountsTotal: 100, date, loansTotal: 0, portfoliosTotal: 0, totalNetWorth: 100 })),
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('drops the previous month when a UTC+1 caller selects August', async () => {
    // Lisbon local midnight on 1 August 2026 is 31 July 23:00 UTC. Read in UTC
    // that is July, so the July point would survive a filter for August.
    givenPoints('2026-07-01', '2026-08-01');

    const rows = await getNetWorthHistoryReport(makeInput({ fromDate: '2026-07-31T23:00:00.000Z', timezone: 'Europe/Lisbon' }));

    expect(rows.map((row) => row.date)).toEqual(['2026-08-01T00:00:00.000Z']);
  });

  it('keeps the selected month for a UTC-4 caller whose period starts mid-day UTC', async () => {
    // New York local midnight on 1 August 2026 is 1 August 04:00 UTC.
    givenPoints('2026-07-01', '2026-08-01');

    const rows = await getNetWorthHistoryReport(makeInput({ fromDate: '2026-08-01T04:00:00.000Z', timezone: 'America/New_York' }));

    expect(rows.map((row) => row.date)).toEqual(['2026-08-01T00:00:00.000Z']);
  });

  it('falls back to the default calendar rather than throwing on an unusable timezone', async () => {
    givenPoints('2026-07-01', '2026-08-01');

    const rows = await getNetWorthHistoryReport(makeInput({ fromDate: '2026-07-31T23:00:00.000Z', timezone: 'Middle/Earth' }));

    expect(rows.map((row) => row.date)).toEqual(['2026-08-01T00:00:00.000Z']);
  });

  it('orders months chronologically across the single- to double-digit boundary', async () => {
    givenPoints('2026-10-01', '2026-09-01');

    const rows = await getNetWorthHistoryReport(makeInput({ fromDate: '2026-08-31T23:00:00.000Z', timezone: 'Europe/Lisbon' }));

    expect(rows.map((row) => row.date)).toEqual(['2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z']);
  });

  it('returns every point when the caller sends no fromDate', async () => {
    givenPoints('2026-07-01', '2026-08-01');

    const rows = await getNetWorthHistoryReport(makeInput());

    expect(rows).toHaveLength(2);
  });

  it('emits the month label as a floating UTC marker, not a zoned instant', async () => {
    // The web chart reads this back with getUTCFullYear()/getUTCMonth(); a
    // zoned instant would render as the previous month there.
    givenPoints('2026-08-01');

    const rows = await getNetWorthHistoryReport(makeInput({ timezone: 'Europe/Lisbon' }));

    expect(rows[0]?.date).toBe('2026-08-01T00:00:00.000Z');
  });

  it('returns one point per month, carrying the closing value of the month', async () => {
    // The history service adds a point on every transaction day, so a busy
    // month yields many points. The report is month-by-month: the month's last
    // point is its closing net worth.
    mocks.getNetWorthHistory.mockResolvedValue({
      points: [
        { accountsTotal: 900, date: '2026-07-31', loansTotal: 0, portfoliosTotal: 0, totalNetWorth: 900 },
        { accountsTotal: 1000, date: '2026-08-03', loansTotal: 0, portfoliosTotal: 0, totalNetWorth: 1000 },
        { accountsTotal: 1100, date: '2026-08-14', loansTotal: 50, portfoliosTotal: 200, totalNetWorth: 1250 },
        { accountsTotal: 1300, date: '2026-08-31', loansTotal: 100, portfoliosTotal: 300, totalNetWorth: 1500 },
        { accountsTotal: 1400, date: '2026-09-02', loansTotal: 100, portfoliosTotal: 300, totalNetWorth: 1600 },
      ],
    });

    const rows = await getNetWorthHistoryReport(makeInput());

    expect(rows).toEqual([
      { breakdown: { assets: 900, liabilities: 0 }, date: '2026-07-01T00:00:00.000Z', netWorth: 900 },
      { breakdown: { assets: 1600, liabilities: 100 }, date: '2026-08-01T00:00:00.000Z', netWorth: 1500 },
      { breakdown: { assets: 1700, liabilities: 100 }, date: '2026-09-01T00:00:00.000Z', netWorth: 1600 },
    ]);
  });

  it('takes the latest point of a month even when points arrive out of order', async () => {
    mocks.getNetWorthHistory.mockResolvedValue({
      points: [
        { accountsTotal: 1500, date: '2026-08-31', loansTotal: 0, portfoliosTotal: 0, totalNetWorth: 1500 },
        { accountsTotal: 1000, date: '2026-08-03', loansTotal: 0, portfoliosTotal: 0, totalNetWorth: 1000 },
      ],
    });

    const rows = await getNetWorthHistoryReport(makeInput());

    expect(rows.map((row) => row.netWorth)).toEqual([1500]);
  });

  it('closes a month on its latest complete point when the final point is incomplete', async () => {
    mocks.getNetWorthHistory.mockResolvedValue({
      points: [
        { accountsTotal: 1000, date: '2026-08-03', loansTotal: 0, portfoliosTotal: 0, totalNetWorth: 1000 },
        { accountsTotal: null, date: '2026-08-31', loansTotal: 0, portfoliosTotal: 0, totalNetWorth: null },
      ],
    });

    const rows = await getNetWorthHistoryReport(makeInput());

    expect(rows.map((row) => row.netWorth)).toEqual([1000]);
  });
});
