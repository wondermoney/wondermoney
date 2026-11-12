import { beforeEach, describe, expect, it, vi } from 'vitest';

import { kyselyDouble } from '@app/__tests__/__helpers__/kysely-double';
import type { InvestmentCashFlow } from '@service/portfolio/portfolio-metrics.utils';
import type { ReportFilters } from '@validators/reports';

import type { ReportServiceInput } from '../report-filters';

type FlowFixture = InvestmentCashFlow & { portfolioKey: number; tenantKey: number };
interface PortfolioFixture { name: string; portfolioKey: number; tenantKey: number }
interface SnapshotFixture { appuserCurrencyKey: { code: string }; appuserCurrencyTotalValue: number; portfolioKey: number; snapshotDate: Date }

const state = vi.hoisted(() => ({
  flows: [] as FlowFixture[],
  liveValues: new Map<number, number>(),
  portfolios: [] as PortfolioFixture[],
  snapshots: [] as SnapshotFixture[],
}));

/**
 * An in-memory household store: `find` applies the tenant predicate the service builds, and
 * `findOne` answers "latest snapshot before this instant", so the tests assert what comes back.
 * The daily snapshots query answers with the asked-for portfolios' snapshots from its start date.
 */
vi.mock('@app/database/di', () => ({
  DI: {
    em: {
      find: vi.fn((_entity: unknown, where: { tenantKey?: { tenantKey?: number } }) =>
        Promise.resolve(state.portfolios.filter((portfolio) => where.tenantKey?.tenantKey === portfolio.tenantKey))),
      findOne: vi.fn((_entity: unknown, where: { portfolioKey: { portfolioKey: number }; snapshotDate: { $lt: Date } }) => {
        const match = state.snapshots
          .filter((snapshot) => snapshot.portfolioKey === where.portfolioKey.portfolioKey && snapshot.snapshotDate < where.snapshotDate.$lt)
          .toSorted((a, b) => b.snapshotDate.getTime() - a.snapshotDate.getTime())[0];
        // Populated as the service asks: the portfolio's owner, who keeps EUR.
        return Promise.resolve(match ? { ...match, portfolioKey: { portfolioKey: match.portfolioKey, portfolioOwnerAppuserKey: { currencyKey: { code: 'EUR' } } } } : null);
      }),
      getKysely: vi.fn(() => kyselyDouble((query) => {
        const keys = query.parameters.find((parameter): parameter is number[] => Array.isArray(parameter)) ?? [];
        const from = query.parameters.find((parameter): parameter is Date => parameter instanceof Date) ?? new Date(0);
        return state.snapshots
          .filter((snapshot) => keys.includes(snapshot.portfolioKey) && snapshot.snapshotDate >= from)
          .toSorted((a, b) => a.snapshotDate.getTime() - b.snapshotDate.getTime())
          .map((snapshot) => ({ currency_code: snapshot.appuserCurrencyKey.code, portfolio_key: snapshot.portfolioKey, snapshot_date: snapshot.snapshotDate, value: String(snapshot.appuserCurrencyTotalValue) }));
      }).db),
    },
  },
}));

vi.mock('@service/portfolio/portfolio-holdings.service', () => ({
  default: {
    getInvestmentCashFlows: vi.fn((_appuserKey: number, tenantKey: number, portfolioKey: number) =>
      Promise.resolve(state.flows.filter((flow) => flow.tenantKey === tenantKey && flow.portfolioKey === portfolioKey))),
    getPortfolioValues: vi.fn((_appuser: unknown, portfolioKeys: number[]) =>
      Promise.resolve(new Map(portfolioKeys.map((key) => [key, { isComplete: true, value: state.liveValues.get(key) ?? 0 }])))),
  },
}));

import { buildPortfolioPerformanceCsv, getPortfolioPerformanceReport } from '../portfolioPerformance.service';
import { REPORT_DEFAULT_TIME_ZONE } from '../report-months';

const NOW = new Date('2026-11-05T12:00:00.000Z');
const TENANT = 113;

const makeInput = (overrides: Partial<ReportFilters> = {}): ReportServiceInput =>
  ({
    filters: {
      fromDate: '2026-08-01T00:00:00.000Z',
      includePending: false,
      includeTransfers: false,
      timezone: REPORT_DEFAULT_TIME_ZONE,
      toDate: '2026-11-30T23:59:59.999Z',
      ...overrides,
    },
    tenant: { tenantKey: TENANT },
    user: { appuserKey: 71, currencyKey: { code: 'EUR' } },
  }) as unknown as ReportServiceInput;

const snapshot = (portfolioKey: number, day: string, value: number): SnapshotFixture =>
  ({ appuserCurrencyKey: { code: 'EUR' }, appuserCurrencyTotalValue: value, portfolioKey, snapshotDate: new Date(`${day}T00:00:00.000Z`) });
const buy = (portfolioKey: number, day: string, amount: number, tenantKey = TENANT): FlowFixture =>
  ({ amount: -amount, currencyCode: 'EUR', date: new Date(`${day}T10:00:00.000Z`), kind: 'BUY', portfolioKey, tenantKey });
const sell = (portfolioKey: number, day: string, amount: number): FlowFixture =>
  ({ amount, currencyCode: 'EUR', date: new Date(`${day}T10:00:00.000Z`), kind: 'SELL', portfolioKey, tenantKey: TENANT });
const dividend = (portfolioKey: number, day: string, amount: number): FlowFixture =>
  ({ amount, currencyCode: 'EUR', date: new Date(`${day}T10:00:00.000Z`), kind: 'DIVIDEND', portfolioKey, tenantKey: TENANT });

describe('getPortfolioPerformanceReport', () => {
  beforeEach(() => {
    state.portfolios = [{ name: 'Long-term', portfolioKey: 7, tenantKey: TENANT }];
    state.snapshots = [];
    state.flows = [];
    state.liveValues = new Map();
  });

  it('opens at the latest snapshot before the period and closes at the live value for a current period', async () => {
    state.snapshots = [snapshot(7, '2026-07-20', 9000), snapshot(7, '2026-07-31', 10_000), snapshot(7, '2026-08-15', 99_999)];
    state.liveValues.set(7, 12_535.86);

    const [row] = await getPortfolioPerformanceReport(makeInput(), NOW);

    expect(row).toMatchObject({ change: 2535.86, endValue: 12_535.86, netContributions: 0, portfolioKey: '7', startValue: 10_000 });
    expect(row?.changePercent).toBeCloseTo(25.36, 2);
  });

  it('takes buys as money in and sales as money out of the change, so contributions are not a gain', async () => {
    state.snapshots = [snapshot(7, '2026-07-31', 10_000)];
    // Before the start snapshot (already in it), in the period, and in the period.
    state.flows = [buy(7, '2026-07-10', 5000), buy(7, '2026-09-01', 1000.1), buy(7, '2026-10-01', 500.2), sell(7, '2026-10-15', 300.1)];
    state.liveValues.set(7, 11_400.2);

    const [row] = await getPortfolioPerformanceReport(makeInput(), NOW);

    // 10 000 + (1 000.10 + 500.20 - 300.10) = 11 200.20 invested; 200 is what the market did.
    expect(row).toMatchObject({ change: 200, endValue: 11_400.2, netContributions: 1200.2, startValue: 10_000 });
  });

  it('reports dividends in the period beside the change', async () => {
    state.snapshots = [snapshot(7, '2026-07-31', 1000)];
    state.flows = [dividend(7, '2026-06-01', 99), dividend(7, '2026-09-10', 12.5), dividend(7, '2026-10-10', 7.5)];
    state.liveValues.set(7, 1000);

    const [row] = await getPortfolioPerformanceReport(makeInput(), NOW);

    expect(row).toMatchObject({ change: 0, dividends: 20, netContributions: 0 });
  });

  it('closes a past period at its snapshot and leaves later trades out', async () => {
    state.snapshots = [snapshot(7, '2026-07-31', 1000), snapshot(7, '2026-08-31', 1600), snapshot(7, '2026-09-30', 5000)];
    state.flows = [buy(7, '2026-08-10', 500), buy(7, '2026-09-10', 3000)];
    state.liveValues.set(7, 99_999);

    const [row] = await getPortfolioPerformanceReport(makeInput({ toDate: '2026-08-31T23:59:59.999Z' }), NOW);

    expect(row).toMatchObject({ change: 100, endValue: 1600, netContributions: 500, startValue: 1000 });
  });

  it('opens a portfolio started in the period at zero', async () => {
    state.flows = [buy(7, '2026-09-01', 2000)];
    state.liveValues.set(7, 2100);

    const [row] = await getPortfolioPerformanceReport(makeInput(), NOW);

    expect(row).toMatchObject({ change: 100, changePercent: 5, netContributions: 2000, startValue: 0 });
  });

  it('leaves the start and change unknown when the portfolio held something but has no snapshot', async () => {
    state.flows = [buy(7, '2026-01-01', 2000)];
    state.liveValues.set(7, 2100);

    const [row] = await getPortfolioPerformanceReport(makeInput(), NOW);

    expect(row).toMatchObject({ change: null, changePercent: null, endValue: 2100, startValue: null });
  });

  it('never lists another household\'s portfolio or counts its trades', async () => {
    state.portfolios = [
      { name: 'Long-term', portfolioKey: 7, tenantKey: TENANT },
      { name: 'Neighbour', portfolioKey: 9, tenantKey: 999 },
    ];
    state.snapshots = [snapshot(7, '2026-07-31', 1000), snapshot(9, '2026-07-31', 50_000)];
    state.flows = [buy(7, '2026-09-01', 100, 999), buy(9, '2026-09-01', 100, 999)];
    state.liveValues = new Map([[7, 1000], [9, 60_000]]);

    const rows = await getPortfolioPerformanceReport(makeInput(), NOW);

    expect(rows.map((row) => row.portfolioKey)).toEqual(['7']);
    expect(rows[0]).toMatchObject({ change: 0, netContributions: 0 });
  });

  it('gives the time-weighted return, unmoved by a deposit, beside the money-weighted one', async () => {
    // 10 000 held, 10 000 more put in on 1 September at an unchanged price, then a 10% rise.
    state.snapshots = [snapshot(7, '2026-07-31', 10_000), snapshot(7, '2026-09-01', 20_000), snapshot(7, '2026-10-01', 22_000)];
    state.flows = [buy(7, '2026-09-01', 10_000)];
    state.liveValues.set(7, 22_000);

    const [row] = await getPortfolioPerformanceReport(makeInput(), NOW);

    expect(row?.timeWeightedReturn).toBe(10);
    // The rise came with all 20 000 in, so the investor's money did better than the investments.
    expect(row?.moneyWeightedReturn).toBeGreaterThan(10);
    expect(row?.moneyWeightedReturnAnnualized).toBe(false);
    // Days without a snapshot between the start and today are reported, not read as zero.
    expect(row?.missingSnapshotDates).toContain('2026-08-15');
    expect(row?.missingSnapshotDates).not.toContain('2026-09-01');
  });

  it('closes both returns of a past period at its end snapshot', async () => {
    state.snapshots = [snapshot(7, '2026-07-31', 1000), snapshot(7, '2026-08-31', 1100), snapshot(7, '2026-09-30', 5000)];
    state.liveValues.set(7, 99_999);

    const [row] = await getPortfolioPerformanceReport(makeInput({ toDate: '2026-08-31T23:59:59.999Z' }), NOW);

    expect(row?.timeWeightedReturn).toBe(10);
    expect(row?.moneyWeightedReturn).toBe(10);
  });

  it('leaves both returns unknown when the start is', async () => {
    state.flows = [buy(7, '2026-01-01', 2000)];
    state.liveValues.set(7, 2100);

    const [row] = await getPortfolioPerformanceReport(makeInput(), NOW);

    expect(row).toMatchObject({ moneyWeightedReturn: null, timeWeightedReturn: null });
  });

  it('returns no rows for a household without portfolios', async () => {
    state.portfolios = [];

    expect(await getPortfolioPerformanceReport(makeInput(), NOW)).toEqual([]);
  });
});

describe('buildPortfolioPerformanceCsv', () => {
  it('emits one 2-decimal row per portfolio, with unknown values left blank', () => {
    const csv = buildPortfolioPerformanceCsv([
      { change: 50, changePercent: 5, currency: 'EUR', dividends: 2, endValue: 1050, missingSnapshotDates: [], moneyWeightedReturn: 5.1, moneyWeightedReturnAnnualized: true, name: 'Long-term', netContributions: 0, portfolioKey: '7', startValue: 1000, timeWeightedReturn: 5.2 },
      { change: null, changePercent: null, currency: 'EUR', dividends: 0, endValue: 300, missingSnapshotDates: ['2026-08-02', '2026-08-03'], moneyWeightedReturn: null, moneyWeightedReturnAnnualized: false, name: 'Tech picks', netContributions: 10, portfolioKey: '8', startValue: null, timeWeightedReturn: null },
    ]);

    const [header, first, second] = csv.replace('﻿', '').trim().split('\n');
    expect(header?.split(',')).toHaveLength(13);
    expect(first).toBe('7,Long-term,EUR,1000.00,0.00,50.00,5.00,2.00,1050.00,5.20,5.10,true,0');
    expect(second).toBe('8,Tech picks,EUR,,10.00,,,0.00,300.00,,,false,2');
  });
});
