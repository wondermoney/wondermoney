import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Appuser } from '@entity/Appuser';

const emMocks = vi.hoisted(() => ({
  find: vi.fn(),
  getKnex: vi.fn(),
  getRepository: vi.fn(),
  populate: vi.fn(),
}));

vi.mock('@app/database/di', () => ({ DI: { em: emMocks } }));
vi.mock('../portfolio/portfolio-dashboard.service', () => ({
  default: { getAggregateDashboard: vi.fn() },
}));

import {
  buildMonthlyHistoryPointDates,
  buildNetWorthSummaryFromSourceRows,
  calculateHistoryReadiness,
  clampHistoryMonths,
  isCurrentHistoryPoint,
  mergeHistoryPointDates,
  NetWorthService,
  resolveAccountHistoryTotal,
  resolveHistoryToDate,
  resolveLoanHistoryTotal,
  resolvePortfolioHistoryTotal,
} from '../net-worth.service';

function appuserWithUnpopulatedCurrency(): Appuser {
  return { currencyKey: {} } as Appuser;
}

beforeEach(() => {
  vi.clearAllMocks();
  emMocks.getRepository.mockReturnValue({
    getAppuserTenantByAppuser: vi.fn().mockResolvedValue({ tenantKey: { tenantKey: 1 } }),
  });
  emMocks.find.mockResolvedValue([]);

  const queryBuilder: { innerJoin: ReturnType<typeof vi.fn>; select: ReturnType<typeof vi.fn> } = {
    innerJoin: vi.fn(),
    select: vi.fn(),
  };
  queryBuilder.select.mockReturnValue(queryBuilder);
  queryBuilder.innerJoin.mockResolvedValue([]);
  const knex = Object.assign(vi.fn(() => queryBuilder), { raw: vi.fn((value: string) => value) });
  emMocks.getKnex.mockReturnValue(knex);
});

describe('NetWorthService currency relation', () => {
  it('populates currency before computing the current summary', async () => {
    const appuser = appuserWithUnpopulatedCurrency();
    emMocks.populate.mockImplementation(() => {
      Object.assign(appuser.currencyKey, { code: 'EUR' });
      return Promise.resolve();
    });

    const result = await new NetWorthService().getNetWorth(appuser);

    expect(emMocks.populate).toHaveBeenCalledWith(appuser, ['currencyKey']);
    expect(result.currencyCode).toBe('EUR');
    expect(emMocks.populate.mock.invocationCallOrder[0]).toBeLessThan(emMocks.find.mock.invocationCallOrder[0] ?? 0);
  });

  it('populates currency before computing history', async () => {
    const appuser = appuserWithUnpopulatedCurrency();
    emMocks.populate.mockImplementation(() => {
      Object.assign(appuser.currencyKey, { code: 'EUR' });
      return Promise.resolve();
    });

    const result = await new NetWorthService().getNetWorthHistory(appuser, { months: 2 });

    expect(emMocks.populate).toHaveBeenCalledWith(appuser, ['currencyKey']);
    expect(result.currencyCode).toBe('EUR');
    expect(emMocks.populate.mock.invocationCallOrder[0]).toBeLessThan(emMocks.find.mock.invocationCallOrder[0] ?? 0);
  });

  it('rejects before source computations when population fails', async () => {
    const populationError = new Error('relation unavailable');
    emMocks.populate.mockRejectedValue(populationError);

    await expect(new NetWorthService().getNetWorth(appuserWithUnpopulatedCurrency())).rejects.toBe(populationError);
    expect(emMocks.find).not.toHaveBeenCalled();
  });

  it('rejects when population does not resolve a currency code', async () => {
    emMocks.populate.mockResolvedValue(undefined);

    await expect(new NetWorthService().getNetWorthHistory(appuserWithUnpopulatedCurrency())).rejects.toThrow(/currency relation/i);
    expect(emMocks.find).not.toHaveBeenCalled();
  });
});

describe('buildNetWorthSummaryFromSourceRows', () => {
  it('includes accounts in assets', () => {
    const result = buildNetWorthSummaryFromSourceRows({
      accounts: [{ balance: 1200, name: 'Cash' }],
      currencyCode: 'EUR',
      loans: [],
      portfolios: [],
    });

    expect(result.assets.accounts).toBe(1200);
    expect(result.totalNetWorth).toBe(1200);
    expect(result.rows).toEqual([{ balance: 1200, name: 'Cash', type: 'accounts' }]);
  });

  it('includes portfolios in assets', () => {
    const result = buildNetWorthSummaryFromSourceRows({
      accounts: [],
      currencyCode: 'EUR',
      loans: [],
      portfolios: [{ balance: 5000, name: 'Brokerage' }],
    });

    expect(result.assets.portfolios).toBe(5000);
    expect(result.totalNetWorth).toBe(5000);
    expect(result.rows).toEqual([{ balance: 5000, name: 'Brokerage', type: 'portfolios' }]);
  });

  it('includes loans as liabilities', () => {
    const result = buildNetWorthSummaryFromSourceRows({
      accounts: [{ balance: 1000, name: 'Cash' }],
      currencyCode: 'EUR',
      loans: [{ balance: 300, name: 'Card' }],
      portfolios: [],
    });

    expect(result.liabilities.loans).toBe(300);
    expect(result.totalNetWorth).toBe(700);
    expect(result.rows).toEqual([
      { balance: 1000, name: 'Cash', type: 'accounts' },
      { balance: -300, name: 'Card', type: 'loans' },
    ]);
  });

  it('flags unsupported portfolio snapshots without appuser currency value', () => {
    const result = buildNetWorthSummaryFromSourceRows({
      accounts: [],
      currencyCode: 'EUR',
      loans: [],
      portfolios: [{ balance: 0, name: 'Brokerage', supportedCurrency: false }],
    });

    expect(result.assets.portfolios).toBe(0);
    expect(result.unsupportedCurrencies.portfolios).toBe(1);
    expect(result.rows).toEqual([{ balance: 0, name: 'Brokerage', type: 'portfolios' }]);
  });

  it('flags unsupported loan currency liabilities while matching currency still counts', () => {
    const result = buildNetWorthSummaryFromSourceRows({
      accounts: [{ balance: 1000, name: 'Cash' }],
      currencyCode: 'EUR',
      loans: [
        { balance: 300, includeInNetWorth: true, name: 'Card', supportedCurrency: true },
        { balance: 200, includeInNetWorth: true, name: 'USD loan', supportedCurrency: false },
      ],
      portfolios: [],
    });

    expect(result.liabilities.loans).toBe(300);
    expect(result.unsupportedCurrencies.loans).toBe(1);
    expect(result.totalNetWorth).toBe(700);
  });

  it('excludes loans from net worth when includeInNetWorth is false', () => {
    const result = buildNetWorthSummaryFromSourceRows({
      accounts: [{ balance: 1000, name: 'Cash' }],
      currencyCode: 'EUR',
      loans: [{ balance: 300, includeInNetWorth: false, name: 'Excluded' }],
      portfolios: [],
    });

    expect(result.liabilities.loans).toBe(0);
    expect(result.totalNetWorth).toBe(1000);
    expect(result.rows).toEqual([{ balance: 1000, name: 'Cash', type: 'accounts' }]);
  });

  it('caps monthly point generation to 12 and defaults to 6', () => {
    expect(clampHistoryMonths()).toBe(6);
    expect(clampHistoryMonths(99)).toBe(12);
    expect(buildMonthlyHistoryPointDates(6, new Date('2026-07-15T12:00:00Z')).map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30', '2026-07-15',
    ]);
    expect(buildMonthlyHistoryPointDates(12, new Date('2026-07-15T12:00:00Z')).length).toBe(12);
  });

  it('clamps future requested history dates to today and identifies current points by date', () => {
    const now = new Date('2026-07-15T18:30:00Z');
    expect(resolveHistoryToDate(new Date('2026-07-20T00:00:00Z'), now).toISOString().slice(0, 10)).toBe('2026-07-15');
    expect(resolveHistoryToDate(new Date('2026-07-14T23:59:59Z'), now).toISOString().slice(0, 10)).toBe('2026-07-14');
    expect(isCurrentHistoryPoint(new Date('2026-07-15T00:00:00Z'), new Date('2026-07-15T12:00:00Z'))).toBe(true);
    expect(isCurrentHistoryPoint(new Date('2026-07-14T00:00:00Z'), new Date('2026-07-15T12:00:00Z'))).toBe(false);
  });

  it('merges monthly and transaction dates while sorting and deduping', () => {
    expect(mergeHistoryPointDates([
      new Date('2026-03-31T00:00:00Z'),
      new Date('2026-05-31T00:00:00Z'),
      new Date('2026-07-15T00:00:00Z'),
    ], [
      new Date('2026-05-10T13:00:00Z'),
      new Date('2026-05-10T23:59:59Z'),
      new Date('2026-06-02T00:00:00Z'),
    ]).map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-03-31', '2026-05-10', '2026-05-31', '2026-06-02', '2026-07-15',
    ]);
  });

  it('derives readiness from complete points', () => {
    expect(calculateHistoryReadiness([{ totalNetWorth: null }, { totalNetWorth: null }])).toBe('empty');
    expect(calculateHistoryReadiness([{ totalNetWorth: 1 }, { totalNetWorth: null }])).toBe('insufficient_history');
    expect(calculateHistoryReadiness([{ totalNetWorth: 1 }, { totalNetWorth: 2 }])).toBe('ready');
  });

  it('resolves account history totals with boundary and missing history rules', () => {
    const pointDate = new Date('2026-07-15T00:00:00Z');
    expect(resolveAccountHistoryTotal([
      { appuserCurrencyBalance: 100, transactionDate: new Date('2026-07-15T09:00:00Z'), transactionKey: 1 },
    ], pointDate)).toEqual({ complete: true, total: 100 });
    expect(resolveAccountHistoryTotal([
      { appuserCurrencyBalance: 100, transactionDate: new Date('2026-07-14T09:00:00Z'), transactionKey: 1 },
      { appuserCurrencyBalance: 125, transactionDate: new Date('2026-07-14T09:00:00Z'), transactionKey: 2 },
    ], new Date('2026-07-15T00:00:00Z'))).toEqual({ complete: true, total: 225 });
    expect(resolveAccountHistoryTotal([
      { appuserCurrencyBalance: null, transactionDate: new Date('2026-07-15T09:00:00Z'), transactionKey: 1 },
    ], pointDate)).toEqual({ complete: false, total: null });
  });

  it('treats account dates before creation as complete zero contribution', () => {
    expect(resolveAccountHistoryTotal([
      { appuserCurrencyBalance: 100, createdAt: new Date('2026-07-10T00:00:00Z'), transactionDate: new Date('2026-07-15T09:00:00Z'), transactionKey: 1 },
    ], new Date('2026-07-05T00:00:00Z'))).toEqual({ complete: true, total: 0 });
  });

  it('uses current account balances only when the point is today and requires non-null balances', () => {
    const today = new Date('2026-07-15T00:00:00Z');
    expect(resolveAccountHistoryTotal([
      { appuserCurrencyBalance: 10, transactionDate: new Date('2026-07-01T00:00:00Z'), transactionKey: 1 },
      { appuserCurrencyBalance: 20, transactionDate: new Date('2026-07-02T00:00:00Z'), transactionKey: 2 },
    ], today, true)).toEqual({ complete: true, total: 30 });
    expect(resolveAccountHistoryTotal([
      { appuserCurrencyBalance: 10, transactionDate: new Date('2026-07-01T00:00:00Z'), transactionKey: 1 },
      { appuserCurrencyBalance: null, transactionDate: new Date('2026-07-02T00:00:00Z'), transactionKey: 2 },
    ], today, true)).toEqual({ complete: false, total: null });
  });

  it('resolves portfolio history totals and selects latest snapshot as of point date', () => {
    const pointDate = new Date('2026-07-15T00:00:00Z');
    expect(resolvePortfolioHistoryTotal([
      { snapshots: [
        { appuserCurrencyTotalValue: 100, portfolioSnapshotKey: 1, snapshotDate: new Date('2026-07-14T00:00:00Z') },
        { appuserCurrencyTotalValue: 125, portfolioSnapshotKey: 2, snapshotDate: new Date('2026-07-15T00:00:00Z') },
      ] },
    ], pointDate)).toEqual({ complete: true, total: 125 });
    expect(resolvePortfolioHistoryTotal([
      { snapshots: [{ appuserCurrencyTotalValue: null, portfolioSnapshotKey: 1, snapshotDate: new Date('2026-07-15T00:00:00Z') }] },
    ], pointDate)).toEqual({ complete: false, total: null });
  });

  it('treats portfolio dates before creation as complete zero contribution', () => {
    expect(resolvePortfolioHistoryTotal([
      { snapshots: [{ appuserCurrencyTotalValue: 100, createdAt: new Date('2026-07-10T00:00:00Z'), portfolioSnapshotKey: 1, snapshotDate: new Date('2026-07-10T00:00:00Z') }] },
    ], new Date('2026-07-05T00:00:00Z'))).toEqual({ complete: true, total: 0 });
  });

  it('resolves loan history totals with as-of filtering and currency compatibility', () => {
    const pointDate = new Date('2026-07-15T00:00:00Z');
    expect(resolveLoanHistoryTotal([
      {
        adjustments: [
          { amount: 20, effectiveDate: new Date('2026-07-16T00:00:00Z') },
          { amount: 10, effectiveDate: new Date('2026-07-15T00:00:00Z') },
        ],
        currencyCode: 'EUR',
        openingBalanceDate: new Date('2026-07-01T00:00:00Z'),
        openingPrincipalBalance: 100,
        repayments: [
          { amount: 30, effectiveDate: new Date('2026-07-15T00:00:00Z') },
          { amount: 40, effectiveDate: new Date('2026-07-16T00:00:00Z') },
        ],
      },
    ], 'EUR', pointDate)).toEqual({ complete: true, total: 80 });
    expect(resolveLoanHistoryTotal([
      {
        currencyCode: 'USD',
        openingBalanceDate: new Date('2026-07-01T00:00:00Z'),
        openingPrincipalBalance: 100,
      },
    ], 'EUR', pointDate)).toEqual({ complete: false, total: null });
  });

  it('readiness becomes ready with two complete transaction-date points', () => {
    expect(calculateHistoryReadiness([{ totalNetWorth: 1 }, { totalNetWorth: 2 }, { totalNetWorth: null }])).toBe('ready');
  });
});
