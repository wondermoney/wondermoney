import { beforeEach, describe, expect, it, vi } from 'vitest';

import { kyselyDouble } from '@app/__tests__/__helpers__/kysely-double';
import type { Appuser } from '@entity/Appuser';

const emMocks = vi.hoisted(() => ({
  find: vi.fn(),
  getKysely: vi.fn(),
  getRepository: vi.fn(),
  populate: vi.fn(),
}));

vi.mock('@app/database/di', () => ({ DI: { em: emMocks } }));
vi.mock('../portfolio/portfolio-dashboard.service', () => ({
  default: { getAggregateDashboard: vi.fn() },
}));
const portfolioValuesMock = vi.hoisted(() => vi.fn());
vi.mock('@service/portfolio/portfolio-holdings.service', () => ({
  default: { getPortfolioValues: portfolioValuesMock },
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
  emMocks.getKysely.mockReturnValue(kyselyDouble().db);
  portfolioValuesMock.mockResolvedValue(new Map());
});

describe('NetWorthService portfolios', () => {
  function appuserInEur(): Appuser {
    emMocks.populate.mockResolvedValue(undefined);
    return { currencyKey: { code: 'EUR' } } as Appuser;
  }

  it('counts every household portfolio at its current value, the value the portfolio screens show', async () => {
    emMocks.find.mockImplementation((entity: { name?: string }) => Promise.resolve(entity.name === 'Portfolio'
      ? [{ name: 'Long-term', portfolioKey: 7 }, { name: 'Tech picks', portfolioKey: 8 }]
      : []));
    portfolioValuesMock.mockResolvedValue(new Map([
      [7, { isComplete: true, value: 12535.86 }],
      [8, { isComplete: true, value: 2453.28 }],
    ]));

    const result = await new NetWorthService().getNetWorth(appuserInEur());

    expect(result.assets.portfolios).toBe(14989.14);
    expect(result.unsupportedCurrencies.portfolios).toBe(0);
    expect(result.rows.filter((row) => row.type === 'portfolios')).toEqual([
      { balance: 12535.86, id: 7, name: 'Long-term', supportedCurrency: true, type: 'portfolios' },
      { balance: 2453.28, id: 8, name: 'Tech picks', supportedCurrency: true, type: 'portfolios' },
    ]);
  });

  it('keeps what a partly priced portfolio is worth and reports the total as incomplete', async () => {
    emMocks.find.mockImplementation((entity: { name?: string }) => Promise.resolve(entity.name === 'Portfolio'
      ? [{ name: 'Long-term', portfolioKey: 7 }]
      : []));
    portfolioValuesMock.mockResolvedValue(new Map([[7, { isComplete: false, value: 100 }]]));

    const result = await new NetWorthService().getNetWorth(appuserInEur());

    expect(result.assets.portfolios).toBe(100);
    expect(result.unsupportedCurrencies.portfolios).toBe(1);
  });
});

describe('NetWorthService history: today is the live net worth', () => {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const lastMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const yesterday = new Date(today.getTime() - 86_400_000);
  const aYearAgo = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1));
  const iso = (date: Date) => date.toISOString().slice(0, 10);

  function seedHousehold() {
    emMocks.populate.mockResolvedValue(undefined);
    const account = { accountKey: 6, accountName: 'Conta Ordenado', accountOwnerAppuserKey: { currencyKey: { code: 'EUR' } }, appuserCurrencyBalance: 289923.86, createdAt: aYearAgo, currencyKey: { code: 'EUR' } };
    const portfolio = { createdAt: aYearAgo, name: 'Long-term', portfolioKey: 7, portfolioOwnerAppuserKey: { currencyKey: { code: 'EUR' } } };
    const loan = { currencyKey: { code: 'EUR' }, loanKey: 7, name: 'Crédito habitação', openingBalanceDate: aYearAgo, openingPrincipalBalance: 168382.33 };
    const snapshots = [
      // Last month's close, and yesterday's snapshot, which misses today's buy.
      { appuserCurrencyKey: { code: 'EUR' }, appuserCurrencyTotalValue: 14286.16, portfolioKey: { portfolioKey: 7 }, portfolioSnapshotKey: 1, snapshotDate: lastMonthEnd },
      { appuserCurrencyKey: { code: 'EUR' }, appuserCurrencyTotalValue: 14592.53, portfolioKey: { portfolioKey: 7 }, portfolioSnapshotKey: 2, snapshotDate: yesterday },
    ];
    emMocks.find.mockImplementation((entity: { name?: string }, where: { snapshotDate?: { $lt: Date } }) => {
      switch (entity.name) {
        case 'Account': return Promise.resolve([account]);
        case 'Loan': return Promise.resolve([loan]);
        case 'Portfolio': return Promise.resolve([portfolio]);
        case 'PortfolioSnapshot': return Promise.resolve(snapshots.filter((snapshot) => snapshot.snapshotDate < (where.snapshotDate?.$lt ?? new Date(8.64e15))));
        default: return Promise.resolve([]);
      }
    });
    // The account's running balance at every past point (the prefetch's lateral join).
    emMocks.getKysely.mockReturnValue(kyselyDouble((query) => {
      const bounds = (query.parameters[0] ?? []) as string[];
      return bounds.map((bound) => ({ account_key: 6, balance: 291402.18, point_date: bound }));
    }).db);
    portfolioValuesMock.mockResolvedValue(new Map([[7, { isComplete: true, value: 14989.14 }]]));
    return { currencyKey: { code: 'EUR' } } as Appuser;
  }

  it('values today\'s point exactly as getNetWorth does, portfolios live rather than from yesterday\'s snapshot', async () => {
    const appuser = seedHousehold();
    const service = new NetWorthService();

    const [summary, history] = await Promise.all([service.getNetWorth(appuser), service.getNetWorthHistory(appuser, { months: 2 })]);

    const latest = history.points.at(-1);
    expect(latest?.date).toBe(iso(today));
    expect(summary.totalNetWorth).toBe(136530.67);
    expect(latest).toEqual({
      accountsTotal: summary.assets.accounts,
      date: iso(today),
      isComplete: true,
      loansTotal: summary.liabilities.loans,
      portfoliosTotal: summary.assets.portfolios,
      totalNetWorth: summary.totalNetWorth,
    });
    expect(latest?.portfoliosTotal).toBe(14989.14);
  });

  it('keeps an earlier point on its snapshot', async () => {
    const history = await new NetWorthService().getNetWorthHistory(seedHousehold(), { months: 2 });

    expect(history.points.find((point) => point.date === iso(lastMonthEnd))).toEqual({
      accountsTotal: 291402.18,
      date: iso(lastMonthEnd),
      isComplete: true,
      loansTotal: 168382.33,
      portfoliosTotal: 14286.16,
      totalNetWorth: 137306.01,
    });
  });

  it('marks today incomplete, still counting what could be valued, when a holding has no price', async () => {
    const appuser = seedHousehold();
    portfolioValuesMock.mockResolvedValue(new Map([[7, { isComplete: false, value: 100 }]]));

    const history = await new NetWorthService().getNetWorthHistory(appuser, { months: 2 });

    expect(history.points.at(-1)).toMatchObject({ isComplete: false, portfoliosTotal: 100, totalNetWorth: 121641.53 });
  });

  it('values a past period end on snapshots only', async () => {
    const appuser = seedHousehold();

    const history = await new NetWorthService().getNetWorthHistory(appuser, { months: 2, toDate: lastMonthEnd });

    expect(portfolioValuesMock).not.toHaveBeenCalled();
    expect(history.points.at(-1)).toMatchObject({ date: iso(lastMonthEnd), portfoliosTotal: 14286.16 });
  });
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
  it('carries each row\'s record id through, so clients can match it', () => {
    const result = buildNetWorthSummaryFromSourceRows({
      accounts: [{ balance: 1200, id: 7, name: 'Cash' }],
      currencyCode: 'EUR',
      loans: [{ balance: 500, id: 3, name: 'Car' }],
      portfolios: [{ balance: 900, id: 2, name: 'Long-term' }],
    });

    expect(result.rows.map((row) => [row.type, row.id])).toEqual([
      ['accounts', 7],
      ['portfolios', 2],
      ['loans', 3],
    ]);
  });

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
