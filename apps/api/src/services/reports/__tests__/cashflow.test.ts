import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReportFilters } from '@validators/reports';

import type { ReportServiceInput } from '../report-filters';

const mocks = vi.hoisted(() => ({ find: vi.fn() }));

vi.mock('@app/database/di', () => ({
  DI: { em: { find: mocks.find } },
}));

import { buildCashflowCsv, getCashflowCsv, getCashflowReport } from '../cashflow.service';
import { REPORT_DEFAULT_TIME_ZONE } from '../report-months';

/**
 * RAD-555 — the boundary cases.
 *
 * Every range below is written the way a client actually builds one: local
 * midnight on the first of the month, and the last millisecond of the last day,
 * both serialised through `toISOString()` (so they arrive as `Z`, carrying no
 * offset of their own). The transactions then sit in the sliver where the
 * caller's calendar month and the UTC calendar month disagree.
 */

const makeFilters = (overrides: Partial<ReportFilters> = {}): ReportFilters =>
  ({
    includePending: false,
    includeTransfers: false,
    timezone: REPORT_DEFAULT_TIME_ZONE,
    ...overrides,
  }) as ReportFilters;

const makeInput = (overrides: Partial<ReportFilters> = {}): ReportServiceInput =>
  ({
    filters: makeFilters(overrides),
    tenant: { tenantKey: 113 },
    user: { appuserKey: 71 },
  }) as unknown as ReportServiceInput;

const makeTransaction = (isoDate: string, amount: number) => ({
  appuserSettlementAmount: amount,
  appuserTransactionCategories: { getItems: () => [] },
  transactionDate: new Date(isoDate),
  transactionKey: 1,
});

const givenTransactions = (...transactions: ReturnType<typeof makeTransaction>[]) => {
  mocks.find.mockResolvedValue(transactions);
};

describe('buildCashflowCsv', () => {
  it('emits the contract column order with 2-decimal amounts and a BOM', () => {
    const csv = buildCashflowCsv([
      { expenses: 300, income: 1000, month: '2026-01-01T00:00:00.000Z', net: 700 },
    ]);

    expect(csv).toBe('\uFEFFmonth,income,expenses,net\n2026-01-01T00:00:00.000Z,1000.00,300.00,700.00\n');
  });
});

describe('getCashflowReport month bucketing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.find.mockResolvedValue([]);
  });

  it('keeps a UTC+1 transaction in the first hour of the period inside the selected month', async () => {
    // Europe/Lisbon, August 2026 (UTC+1): local 1 Aug 00:30 is 31 Jul 23:30 UTC.
    givenTransactions(makeTransaction('2026-07-31T23:30:00.000Z', 1000));

    const rows = await getCashflowReport(
      makeInput({
        fromDate: '2026-07-31T23:00:00.000Z',
        timezone: 'Europe/Lisbon',
        toDate: '2026-08-31T22:59:59.999Z',
      }),
    );

    expect(rows).toEqual([{ expenses: 0, income: 1000, month: '2026-08-01T00:00:00.000Z', net: 1000 }]);
    expect(rows.map((row) => row.month)).not.toContain('2026-07-01T00:00:00.000Z');
  });

  it('keeps a UTC-4 transaction in the last hours of the period inside the selected month', async () => {
    // America/New_York, August 2026 (UTC-4): local 31 Aug 22:00 is 1 Sep 02:00 UTC.
    givenTransactions(makeTransaction('2026-09-01T02:00:00.000Z', -250));

    const rows = await getCashflowReport(
      makeInput({
        fromDate: '2026-08-01T04:00:00.000Z',
        timezone: 'America/New_York',
        toDate: '2026-09-01T03:59:59.999Z',
      }),
    );

    expect(rows).toEqual([{ expenses: 250, income: 0, month: '2026-08-01T00:00:00.000Z', net: -250 }]);
    expect(rows.map((row) => row.month)).not.toContain('2026-09-01T00:00:00.000Z');
  });

  it('follows the DST offset change inside the period rather than a fixed offset', async () => {
    // Lisbon leaves summer time on 25 Oct 2026, so 31 Oct 23:30 UTC is still
    // October locally — a fixed +1 offset would file it under November.
    givenTransactions(
      makeTransaction('2026-09-30T23:30:00.000Z', 100), // +1 summer time -> 1 Oct local
      makeTransaction('2026-10-31T23:30:00.000Z', 200), // +0 winter time -> 31 Oct local
    );

    const rows = await getCashflowReport(makeInput({ timezone: 'Europe/Lisbon' }));

    expect(rows).toEqual([{ expenses: 0, income: 300, month: '2026-10-01T00:00:00.000Z', net: 300 }]);
  });

  it('buckets in the default calendar when the caller sends no timezone', async () => {
    givenTransactions(makeTransaction('2026-07-31T23:30:00.000Z', 1000));

    const rows = await getCashflowReport({ ...makeInput(), filters: makeFilters({ timezone: undefined }) });

    expect(rows).toEqual([{ expenses: 0, income: 1000, month: '2026-08-01T00:00:00.000Z', net: 1000 }]);
  });

  it('falls back to the default calendar rather than throwing on an unusable timezone', async () => {
    givenTransactions(makeTransaction('2026-07-31T23:30:00.000Z', 1000));

    const rows = await getCashflowReport(makeInput({ timezone: 'Middle/Earth' }));

    expect(rows).toEqual([{ expenses: 0, income: 1000, month: '2026-08-01T00:00:00.000Z', net: 1000 }]);
  });

  it('leaves a month with no transactions absent instead of emitting a zero row', async () => {
    givenTransactions(
      makeTransaction('2026-01-15T12:00:00.000Z', 500),
      makeTransaction('2026-03-15T12:00:00.000Z', -200),
    );

    const rows = await getCashflowReport(makeInput({ timezone: 'Europe/Lisbon' }));

    expect(rows.map((row) => row.month)).toEqual(['2026-01-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z']);
  });

  it('keeps a measured zero as a real row, distinct from an absent month', async () => {
    givenTransactions(
      makeTransaction('2026-01-15T12:00:00.000Z', 500),
      makeTransaction('2026-01-16T12:00:00.000Z', -500),
    );

    const rows = await getCashflowReport(makeInput({ timezone: 'Europe/Lisbon' }));

    expect(rows).toEqual([{ expenses: 500, income: 500, month: '2026-01-01T00:00:00.000Z', net: 0 }]);
  });

  it('orders months chronologically across the single- to double-digit boundary', async () => {
    givenTransactions(
      makeTransaction('2026-11-10T12:00:00.000Z', 300),
      makeTransaction('2026-09-10T12:00:00.000Z', 100),
      makeTransaction('2026-10-10T12:00:00.000Z', 200),
    );

    const rows = await getCashflowReport(makeInput({ timezone: 'Europe/Lisbon' }));

    expect(rows.map((row) => row.month)).toEqual([
      '2026-09-01T00:00:00.000Z',
      '2026-10-01T00:00:00.000Z',
      '2026-11-01T00:00:00.000Z',
    ]);
  });
});

describe('getCashflowCsv', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.find.mockResolvedValue([]);
  });

  it('exports exactly the rows the JSON response returns for the same query', async () => {
    const transactions = [
      makeTransaction('2026-07-31T23:30:00.000Z', 1000),
      makeTransaction('2026-08-10T12:00:00.000Z', -400),
      makeTransaction('2026-08-31T22:30:00.000Z', 250),
    ];
    const input = makeInput({
      fromDate: '2026-07-31T23:00:00.000Z',
      timezone: 'Europe/Lisbon',
      toDate: '2026-08-31T22:59:59.999Z',
    });

    givenTransactions(...transactions);
    const rows = await getCashflowReport(input);
    givenTransactions(...transactions);
    const csv = await getCashflowCsv(input);

    expect(csv).toBe(buildCashflowCsv(rows));
    expect(csv).toBe('\uFEFFmonth,income,expenses,net\n2026-08-01T00:00:00.000Z,1250.00,400.00,850.00\n');
  });
});
