import type { CompiledQuery } from 'kysely';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { kyselyDouble } from '@app/__tests__/__helpers__/kysely-double';
import { DI } from '@app/app';
import { FINANCIAL_TRANSACTION_TYPES } from '@app/constants/financial-transaction-types';
import type { Appuser } from '@entity/Appuser';
import logger from '@utils/logger';

vi.mock('@app/app', () => ({ DI: { em: {} } }));
// vi.hoisted so the mock fn is a plain variable (not a property access), avoiding
// @typescript-eslint/unbound-method warnings when tests override its return value per-call.
const { getCurrentAssetPricesMock } = vi.hoisted(() => ({ getCurrentAssetPricesMock: vi.fn().mockResolvedValue([]) }));
vi.mock('../asset-price.service', () => ({ default: { getCurrentAssetPrices: getCurrentAssetPricesMock } }));

import portfolioHoldingsService from '../portfolio-holdings.service';
import { aggregateBatchesIntoAssets, buildSplitAdjustedHoldingBatches } from '../portfolio-holdings.utils';
import type { HoldingBatch } from '../portfolio-holdings.utils';

// Standard-cohort premium schedule (applies to any subscription date) and a base-rate history
// wide enough that a Savings Certificate lot subscribed in 2024 values without throwing,
// regardless of how far "now" (the implicit default asOfDate) has advanced.
const caStandardPremiumRows = [{ cohort_start_date: null, financial_asset_key: 100, premium_bps: 25, year_from: 1, year_to: null }];
const caWideRateRows = [
  { base_rate_bps: 250, effective_month: new Date('2024-01-01'), financial_asset_key: 100 },
  { base_rate_bps: 250, effective_month: new Date('2024-04-01'), financial_asset_key: 100 },
  { base_rate_bps: 250, effective_month: new Date('2024-07-01'), financial_asset_key: 100 },
  { base_rate_bps: 250, effective_month: new Date('2024-10-01'), financial_asset_key: 100 },
];

const makeBatch = (overrides: Partial<HoldingBatch> = {}): HoldingBatch => ({
  financial_asset_currency_code: 'USD',
  financial_asset_esg_score: undefined,
  financial_asset_key: 1,
  financial_asset_logo_url: undefined,
  financial_asset_name: 'Apple Inc.',
  financial_asset_symbol: 'AAPL',
  financial_asset_type_name: 'Stock',
  financial_transaction_type_key: 1,
  portfolio_key: 1,
  quantity: 100,
  remaining_batch: 100,
  transaction_date: new Date('2024-01-15'),
  transaction_key: 1,
  unit_appuser_amount: undefined,
  unit_settlement_amount: 150,
  ...overrides,
});

const makeTimelineTransaction = (overrides: Partial<HoldingBatch> = {}) =>
  ({
    ...makeBatch(overrides),
    itemType: 'TRANSACTION' as const,
    remaining_batch: undefined,
  });

const makeSplit = (overrides: { date: Date; denominator: number; financial_asset_key: number; numerator: number }) => ({
  ...overrides,
  itemType: 'SPLIT' as const,
});

const makeTransactionRow = (overrides: Record<string, unknown> = {}) => ({
  appuser_unit_amount: 100,
  financial_asset_currency_code: 'USD',
  financial_asset_key: 1,
  financial_asset_name: 'Apple Inc.',
  financial_asset_symbol: 'AAPL',
  financial_asset_type_name: 'Stock',
  financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.BUY,
  portfolio_key: 7,
  portfolio_name: 'Primary',
  quantity: 1,
  settlement_unit_amount: 100,
  transaction_date: new Date('2024-01-01T00:00:00Z'),
  transaction_key: 1,
  ...overrides,
});

interface LoggedQuery {
  /** `alias.column = value` comparisons in the query. */
  predicates: Record<string, unknown>;
  sql: string;
}

function equalityPredicates({ parameters, sql }: CompiledQuery): Record<string, unknown> {
  const predicates: Record<string, unknown> = {};
  for (const [, table, column, index] of sql.matchAll(/"(\w+)"\."(\w+)" = \$(\d+)/g)) {
    predicates[`${table}.${column}`] = parameters[Number(index) - 1];
  }
  return predicates;
}

/** The names of a select's output columns: each item's alias, else its column. */
function projectRow(row: Record<string, unknown>, selected: string[]) {
  if (selected.length === 0) return row;

  return selected.reduce<Record<string, unknown>>((acc, key) => {
    if (key in row) acc[key] = row[key];
    return acc;
  }, {});
}

function selectedColumns(sql: string): string[] {
  const list = /^select (.*?) from /s.exec(sql)?.[1] ?? '';
  return list.split(/, (?![^(]*\))/).map((item) => /as "(\w+)"$/.exec(item.trim())?.[1] ?? /"(\w+)"$/.exec(item.trim())?.[1] ?? item.trim());
}

const makeDatabaseMock = ({
  caPremiumRows = [],
  caRateRows = [],
  caTaxExemptRows = [],
  exchangeRateRow,
  exchangeRateRows = [],
  queryLog,
  rawRows = [],
  splitRows = [],
}: {
  caPremiumRows?: Record<string, unknown>[];
  caRateRows?: Record<string, unknown>[];
  caTaxExemptRows?: Record<string, unknown>[];
  exchangeRateRow?: undefined | { rate: string };
  exchangeRateRows?: { date: Date | string; rate: number | string }[];
  queryLog?: LoggedQuery[];
  rawRows?: unknown[];
  splitRows?: unknown[];
}) => {
  const respond = (query: CompiledQuery): unknown[] => {
    const { parameters, sql } = query;
    const predicates = equalityPredicates(query);
    queryLog?.push({ predicates, sql });
    if (sql.includes('from "financial_asset_stock_adjustment"')) return splitRows;
    if (sql.includes('from "certificado_aforro_rate_period"')) return caRateRows;
    if (sql.includes('from "certificado_aforro_premium_schedule"')) return caPremiumRows;
    if (sql.includes('from "certificado_aforro_subscription_detail"')) return caTaxExemptRows;
    if (sql.includes('from "exchange_rate"')) {
      // The latest rate per currency pair, for current prices: none in these fixtures.
      if (!sql.includes(' limit ')) return [];
      const cutoffIndex = /"date" <= \$(\d+)/.exec(sql)?.[1];
      // The Savings Certificate EUR rate, or a fee's rate as of its transaction date.
      if (cutoffIndex === undefined || exchangeRateRows.length === 0) return exchangeRateRow ? [exchangeRateRow] : [];
      const cutoff = parameters[Number(cutoffIndex) - 1];
      const cutoffTime = cutoff instanceof Date ? cutoff.getTime() : Number.POSITIVE_INFINITY;
      const matchingRates = exchangeRateRows
        .filter((rate) => new Date(rate.date).getTime() <= cutoffTime)
        .toSorted((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      return matchingRates.slice(0, 1);
    }
    if (!sql.includes('from "financial_transaction" as "ft"')) return [];
    const filteredRows = (rawRows as Record<string, unknown>[]).filter((row) =>
      Object.entries(predicates).every(([column, value]) => {
        if (column === 'ft.tenant_key') return row['tenant_key'] == null || row['tenant_key'] === value;
        if (column === 'p.tenant_key') return row['portfolio_tenant_key'] == null || row['portfolio_tenant_key'] === value;
        if (column === 'ft.portfolio_key') return row['portfolio_key'] == null || row['portfolio_key'] === value;
        if (column === 'ft.appuser_key') return row['appuser_key'] == null || row['appuser_key'] === value;
        return true;
      }),
    );
    return filteredRows.map((row) => projectRow(row, selectedColumns(sql)));
  };
  return vi.fn(() => kyselyDouble(respond).db);
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(DI.em, {
    getKysely: makeDatabaseMock({}),
  });
});

describe('portfolio holdings - FIFO aggregation', () => {
  it('handles a single buy with no sells', () => {
    const batches = [makeBatch({ remaining_batch: 100, unit_settlement_amount: 150 })];
    const result = aggregateBatchesIntoAssets(batches);
    expect(result).toHaveLength(1);
    expect(result[0]!.quantity).toBe(100);
    expect(result[0]!.averageBuyPrice).toBe(150);
  });

  it('handles buy+sell with partial sell (remaining from single lot)', () => {
    const batches = [
      makeBatch({ remaining_batch: 30, transaction_key: 1, unit_settlement_amount: 150 }),
      makeBatch({ financial_transaction_type_key: 2, remaining_batch: null, transaction_key: 2 }),
    ];
    const result = aggregateBatchesIntoAssets(batches);
    expect(result).toHaveLength(1);
    expect(result[0]!.quantity).toBe(30);
    expect(result[0]!.averageBuyPrice).toBe(150);
  });

  it('handles multiple lots with FIFO (oldest sold first)', () => {
    // Buy 100 @ $10, Buy 50 @ $12, Sell 120
    // FIFO: lot1 fully sold (0 remaining), lot2 has 30 remaining
    const batches = [
      makeBatch({ quantity: 100, remaining_batch: 0, transaction_key: 1, unit_settlement_amount: 10 }),
      makeBatch({ quantity: 50, remaining_batch: 30, transaction_key: 2, unit_settlement_amount: 12 }),
    ];
    const result = aggregateBatchesIntoAssets(batches);
    expect(result).toHaveLength(1);
    expect(result[0]!.quantity).toBe(30);
    expect(result[0]!.averageBuyPrice).toBe(12);
  });

  it('calculates weighted average buy price across remaining lots', () => {
    // Lot1: 50 remaining @ $10, Lot2: 50 remaining @ $20
    // Weighted avg = (50*10 + 50*20) / 100 = $15
    const batches = [
      makeBatch({ remaining_batch: 50, transaction_key: 1, unit_settlement_amount: 10 }),
      makeBatch({ remaining_batch: 50, transaction_key: 2, unit_settlement_amount: 20 }),
    ];
    const result = aggregateBatchesIntoAssets(batches);
    expect(result).toHaveLength(1);
    expect(result[0]!.quantity).toBe(100);
    expect(result[0]!.averageBuyPrice).toBe(15);
  });

  it('handles sell all (zero remaining)', () => {
    const batches = [
      makeBatch({ remaining_batch: 0, transaction_key: 1, unit_settlement_amount: 150 }),
    ];
    const result = aggregateBatchesIntoAssets(batches);
    expect(result).toHaveLength(0);
  });

  it('handles multiple assets independently', () => {
    const batches = [
      makeBatch({ financial_asset_key: 1, financial_asset_symbol: 'AAPL', remaining_batch: 50, unit_settlement_amount: 150 }),
      makeBatch({ financial_asset_key: 2, financial_asset_name: 'Alphabet', financial_asset_symbol: 'GOOGL', remaining_batch: 25, transaction_key: 2, unit_settlement_amount: 140 }),
    ];
    const result = aggregateBatchesIntoAssets(batches);
    expect(result).toHaveLength(2);
    expect(result[0]!.financialAssetSymbol).toBe('AAPL');
    expect(result[1]!.financialAssetSymbol).toBe('GOOGL');
  });

  it('filters out null remaining_batch (sell rows)', () => {
    const batches = [
      makeBatch({ remaining_batch: 50, transaction_key: 1 }),
      makeBatch({ financial_transaction_type_key: 2, remaining_batch: null, transaction_key: 2 }),
    ];
    const result = aggregateBatchesIntoAssets(batches);
    expect(result).toHaveLength(1);
    expect(result[0]!.quantity).toBe(50);
  });

  it('prefers appuser unit amount for average buy price when available', () => {
    const batches = [
      makeBatch({
        remaining_batch: 2,
        unit_appuser_amount: 120,
        unit_settlement_amount: 112.8,
      }),
    ];

    const result = aggregateBatchesIntoAssets(batches);

    expect(result[0]!.averageBuyPrice).toBe(120);
  });
});

describe('buildSplitAdjustedHoldingBatches', () => {
  it('applies multiple splits before aggregation', () => {
    const batches = buildSplitAdjustedHoldingBatches([
      makeTimelineTransaction({ quantity: 2, transaction_date: new Date('2024-01-01'), transaction_key: 1, unit_settlement_amount: 65.5 }),
      makeSplit({ date: new Date('2024-02-01'), denominator: 1, financial_asset_key: 1, numerator: 7 }),
      makeSplit({ date: new Date('2024-03-01'), denominator: 1, financial_asset_key: 1, numerator: 4 }),
    ]);

    const result = aggregateBatchesIntoAssets(batches);

    expect(result[0]!.quantity).toBe(56);
    expect(result[0]!.averageBuyPrice).toBeCloseTo(131 / 56);
    expect(result[0]!.averageBuyPrice * result[0]!.quantity).toBeCloseTo(131);
  });

  it('consumes adjusted FIFO quantity after a split', () => {
    const batches = buildSplitAdjustedHoldingBatches([
      makeTimelineTransaction({ quantity: 2, transaction_date: new Date('2024-01-01'), transaction_key: 1, unit_settlement_amount: 100 }),
      makeSplit({ date: new Date('2024-02-01'), denominator: 1, financial_asset_key: 1, numerator: 4 }),
      makeTimelineTransaction({ financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.SELL, quantity: -3, transaction_date: new Date('2024-03-01'), transaction_key: 2, unit_settlement_amount: 100 }),
    ]);

    const result = aggregateBatchesIntoAssets(batches);

    expect(result[0]!.quantity).toBe(5);
    expect(result[0]!.averageBuyPrice).toBe(25);
  });

  it('allocates purchase fees proportionally to sold and open FIFO basis', () => {
    const replay = buildSplitAdjustedHoldingBatches([
      makeTimelineTransaction({ fee_amount: 2, quantity: 10, transaction_date: new Date('2024-01-01'), transaction_key: 1, unit_settlement_amount: 10 }),
      makeTimelineTransaction({ fee_amount: 1, financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.SELL, quantity: -4, transaction_date: new Date('2024-01-02'), transaction_key: 2, unit_settlement_amount: 15 }),
    ]);
    const holding = aggregateBatchesIntoAssets(replay)[0]!;

    expect(holding.quantity).toBe(6);
    expect(holding.averageBuyPrice).toBeCloseTo(10.2, 8);
    expect(replay[0]!.remaining_fee_amount).toBeCloseTo(1.2, 8);
  });

  it('preserves a lot commission total across a stock split', () => {
    const replay = buildSplitAdjustedHoldingBatches([
      makeTimelineTransaction({ fee_amount: 4, quantity: 2, transaction_date: new Date('2024-01-01'), transaction_key: 1, unit_settlement_amount: 100 }),
      makeSplit({ date: new Date('2024-02-01'), denominator: 1, financial_asset_key: 1, numerator: 2 }),
      makeTimelineTransaction({ fee_amount: 1, financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.SELL, quantity: -1, transaction_date: new Date('2024-03-01'), transaction_key: 2, unit_settlement_amount: 60 }),
    ]);

    expect(aggregateBatchesIntoAssets(replay)[0]!.averageBuyPrice).toBeCloseTo(51, 8);
    expect(replay[0]!.remaining_fee_amount).toBe(3);
  });

  it('handles reverse splits', () => {
    const batches = buildSplitAdjustedHoldingBatches([
      makeTimelineTransaction({ quantity: 100, transaction_date: new Date('2024-01-01'), transaction_key: 1, unit_settlement_amount: 2 }),
      makeSplit({ date: new Date('2024-02-01'), denominator: 10, financial_asset_key: 1, numerator: 1 }),
    ]);

    const result = aggregateBatchesIntoAssets(batches);

    expect(result[0]!.quantity).toBe(10);
    expect(result[0]!.averageBuyPrice).toBe(20);
  });

  it('applies same-day split before sell', () => {
    const batches = buildSplitAdjustedHoldingBatches([
      makeTimelineTransaction({ quantity: 2, transaction_date: new Date('2024-01-01'), transaction_key: 1, unit_settlement_amount: 100 }),
      makeSplit({ date: new Date('2024-02-01'), denominator: 1, financial_asset_key: 1, numerator: 4 }),
      makeTimelineTransaction({ financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.SELL, quantity: -3, transaction_date: new Date('2024-02-01'), transaction_key: 2, unit_settlement_amount: 100 }),
    ]);

    const result = aggregateBatchesIntoAssets(batches);

    expect(result[0]!.quantity).toBe(5);
  });

  it('ignores split with zero denominator', () => {
    const batches = buildSplitAdjustedHoldingBatches([
      makeTimelineTransaction({ quantity: 10, transaction_date: new Date('2024-01-01'), transaction_key: 1, unit_settlement_amount: 5 }),
      makeSplit({ date: new Date('2024-02-01'), denominator: 0, financial_asset_key: 1, numerator: 1 }),
    ]);

    const result = aggregateBatchesIntoAssets(batches);

    expect(result[0]!.quantity).toBe(10);
    expect(result[0]!.averageBuyPrice).toBe(5);
  });

  it('consumes sell timeline items using transaction type key even with positive quantity', () => {
    const batches = buildSplitAdjustedHoldingBatches([
      makeTimelineTransaction({ quantity: 10, transaction_date: new Date('2024-01-01'), transaction_key: 1, unit_settlement_amount: 5 }),
      makeTimelineTransaction({
        financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.SELL,
        quantity: 3,
        transaction_date: new Date('2024-01-02'),
        transaction_key: 2,
        unit_settlement_amount: 5,
      }),
    ]);

    const result = aggregateBatchesIntoAssets(batches);

    expect(result[0]!.quantity).toBe(7);
    expect(result[0]!.averageBuyPrice).toBe(5);
  });

  it('ignores negative numerator and denominator split ratios', () => {
    const batches = buildSplitAdjustedHoldingBatches([
      makeTimelineTransaction({ quantity: 10, transaction_date: new Date('2024-01-01'), transaction_key: 1, unit_settlement_amount: 5 }),
      makeSplit({ date: new Date('2024-02-01'), denominator: -2, financial_asset_key: 1, numerator: -1 }),
    ]);

    const result = aggregateBatchesIntoAssets(batches);

    expect(result[0]!.quantity).toBe(10);
    expect(result[0]!.averageBuyPrice).toBe(5);
  });

  it('divides unit_appuser_amount by split ratio', () => {
    const batches = buildSplitAdjustedHoldingBatches([
      makeTimelineTransaction({
        quantity: 4,
        transaction_date: new Date('2024-01-01'),
        transaction_key: 1,
        unit_appuser_amount: 20,
        unit_settlement_amount: 10,
      }),
      makeSplit({ date: new Date('2024-02-01'), denominator: 1, financial_asset_key: 1, numerator: 2 }),
    ]);

    expect(batches[0]!.unit_appuser_amount).toBe(10);
    expect(batches[0]!.unit_settlement_amount).toBe(5);
    expect(batches[0]!.quantity).toBe(8);
  });

  it('uses split_ratio fallback when numerator and denominator are missing', () => {
    const batches = buildSplitAdjustedHoldingBatches([
      makeTimelineTransaction({ quantity: 3, transaction_date: new Date('2024-01-01'), transaction_key: 1, unit_settlement_amount: 10 }),
      { date: new Date('2024-02-01'), denominator: undefined as unknown as number, financial_asset_key: 1, itemType: 'SPLIT' as const, numerator: undefined as unknown as number, split_ratio: 4 },
    ]);

    expect(batches[0]!.quantity).toBe(12);
    expect(batches[0]!.unit_settlement_amount).toBe(2.5);
  });

  it('ignores malformed SELL quantities', () => {
    const batches = buildSplitAdjustedHoldingBatches([
      makeTimelineTransaction({ quantity: 10, transaction_date: new Date('2024-01-01'), transaction_key: 1, unit_settlement_amount: 5 }),
      makeTimelineTransaction({
        financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.SELL,
        quantity: 'not-a-number' as unknown as number,
        transaction_date: new Date('2024-01-02'),
        transaction_key: 2,
        unit_settlement_amount: 5,
      }),
    ]);

    const result = aggregateBatchesIntoAssets(batches);

    expect(result[0]!.quantity).toBe(10);
    expect(result[0]!.averageBuyPrice).toBe(5);
  });

  it('ignores malformed BUY unit prices', () => {
    const batches = buildSplitAdjustedHoldingBatches([
      makeTimelineTransaction({
        quantity: 10,
        transaction_date: new Date('2024-01-01'),
        transaction_key: 1,
        unit_settlement_amount: 'not-a-number' as unknown as number,
      }),
    ]);

    expect(batches).toHaveLength(0);
  });
});

describe('portfolio holdings service', () => {
  it('applies tenant predicates to aggregate holdings queries', async () => {
    const queryLog: LoggedQuery[] = [];
    Object.assign(DI.em, {
      getKysely: makeDatabaseMock({
        queryLog,
        rawRows: [
          makeTransactionRow({ portfolio_tenant_key: 7, tenant_key: 7 }),
          makeTransactionRow({ financial_asset_key: 2, portfolio_key: 8, portfolio_tenant_key: 8, tenant_key: 8, transaction_key: 2 }),
        ],
      }),
    });

    const result = await portfolioHoldingsService.getPortfoliosHoldings({ appuserKey: 1, currencyKey: { code: 'USD' } } as Appuser, 7);

    const transactionQuery = queryLog.find(({ sql }) => sql.includes('from "financial_transaction" as "ft"'));
    expect(transactionQuery?.predicates).toMatchObject({ 'ft.tenant_key': 7, 'p.tenant_key': 7 });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ financialAssetKey: 1 });
  });

  it('does not return a foreign portfolio when its transaction tenant is stale', async () => {
    const queryLog: LoggedQuery[] = [];
    Object.assign(DI.em, {
      getKysely: makeDatabaseMock({
        queryLog,
        rawRows: [makeTransactionRow({ portfolio_key: 99, portfolio_tenant_key: 8, tenant_key: 7 })],
      }),
    });

    const result = await portfolioHoldingsService.getPortfolioHoldings(
      { appuserKey: 1, currencyKey: { code: 'USD' } } as Appuser,
      99,
      7,
    );

    const transactionQuery = queryLog.find(({ sql }) => sql.includes('from "financial_transaction" as "ft"'));
    expect(transactionQuery?.predicates).toMatchObject({ 'ft.portfolio_key': 99, 'ft.tenant_key': 7, 'p.tenant_key': 7 });
    expect(result).toEqual([]);
  });

  it('uses stored split rows when calculating holdings', async () => {
    Object.assign(DI.em, {
      getKysely: makeDatabaseMock({
        rawRows: [
          {
            appuser_unit_amount: 65.5,
            financial_asset_currency_code: 'USD',
            financial_asset_key: 11,
            financial_asset_name: 'Apple Inc.',
            financial_asset_symbol: 'AAPL',
            financial_asset_type_name: 'Stock',
            financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.BUY,
            portfolio_key: 7,
            portfolio_name: 'Primary',
            quantity: 2,
            settlement_unit_amount: 65.5,
            transaction_date: new Date('2024-01-01T00:00:00Z'),
            transaction_key: 1,
          },
        ],
        splitRows: [
          { date: new Date('2024-02-01T00:00:00Z'), denominator: 1, financial_asset_key: 11, numerator: 7 },
          { date: new Date('2024-03-01T00:00:00Z'), denominator: 1, financial_asset_key: 11, numerator: 4 },
        ],
      }),
    });

    const result = await portfolioHoldingsService.getPortfolioHoldings({ appuserKey: 1, currencyKey: { code: 'USD' } } as Appuser, 7);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      averageBuyPrice: 131 / 56,
      financialAssetCurrencyCode: 'USD',
      quantity: 56,
    });
  });

  it('surfaces a holding with no financial_asset_type_name as Unclassified instead of dropping it', async () => {
    Object.assign(DI.em, {
      getKysely: makeDatabaseMock({
        rawRows: [
          {
            appuser_unit_amount: 100,
            financial_asset_currency_code: 'USD',
            financial_asset_key: 12,
            financial_asset_name: 'Mystery Asset',
            financial_asset_symbol: 'MYST',
            financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.BUY,
            portfolio_key: 7,
            portfolio_name: 'Primary',
            quantity: 5,
            settlement_unit_amount: 100,
            transaction_date: new Date('2024-01-01T00:00:00Z'),
            transaction_key: 1,
            // financial_asset_type_name intentionally omitted — simulates a left-joined NULL
          },
        ],
      }),
    });

    const result = await portfolioHoldingsService.getPortfolioHoldings({ appuserKey: 1, currencyKey: { code: 'USD' } } as Appuser, 7);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ financialAssetType: 'Unclassified', quantity: 5 });
  });

  it('applies same-day split before transaction even if split is later in time', () => {
    const batches = buildSplitAdjustedHoldingBatches([
      makeTimelineTransaction({
        financial_asset_key: 11,
        quantity: 2,
        transaction_date: new Date('2024-01-01T08:00:00Z'),
        transaction_key: 1,
        unit_appuser_amount: 65.5,
        unit_settlement_amount: 65.5,
      }),
      makeTimelineTransaction({
        financial_asset_key: 11,
        financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.SELL,
        quantity: -6,
        transaction_date: new Date('2024-01-02T09:00:00Z'),
        transaction_key: 2,
        unit_appuser_amount: 65.5,
        unit_settlement_amount: 65.5,
      }),
      makeSplit({ date: new Date('2024-01-02T18:00:00Z'), denominator: 1, financial_asset_key: 11, numerator: 4 }),
    ]);

    const aggregated = aggregateBatchesIntoAssets(batches);

    expect(aggregated[0]!.quantity).toBe(2);
    expect(aggregated[0]!.averageBuyPrice).toBe(65.5 / 4);
  });

  it('orders same-day transactions by timestamp before transaction key', () => {
    const batches = buildSplitAdjustedHoldingBatches([
      makeTimelineTransaction({
        financial_asset_key: 11,
        quantity: 2,
        transaction_date: new Date('2024-01-01T09:00:00Z'),
        transaction_key: 20,
        unit_settlement_amount: 10,
      }),
      makeTimelineTransaction({
        financial_asset_key: 11,
        financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.SELL,
        quantity: -1,
        transaction_date: new Date('2024-01-01T10:00:00Z'),
        transaction_key: 10,
        unit_settlement_amount: 10,
      }),
    ]);

    const aggregated = aggregateBatchesIntoAssets(batches);

    expect(aggregated[0]!.quantity).toBe(1);
  });

  it('does not mark a split-adjusted full sell as invalid', async () => {
    Object.assign(DI.em, {
      getKysely: makeDatabaseMock({
        rawRows: [
          {
            financial_asset_currency_code: 'USD',
            financial_asset_key: 11,
            financial_asset_name: 'Apple Inc.',
            financial_asset_symbol: 'AAPL',
            financial_asset_type_name: 'Stock',
            financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.BUY,
            portfolio_key: 7,
            quantity: 2,
            remaining_batch: 0,
            transaction_date: new Date('2024-01-01T00:00:00Z'),
            transaction_key: 1,
            unit_appuser_amount: 65.5,
            unit_settlement_amount: 65.5,
          },
          {
            financial_asset_currency_code: 'USD',
            financial_asset_key: 11,
            financial_asset_name: 'Apple Inc.',
            financial_asset_symbol: 'AAPL',
            financial_asset_type_name: 'Stock',
            financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.SELL,
            portfolio_key: 7,
            quantity: -8,
            remaining_batch: null,
            transaction_date: new Date('2024-02-02T00:00:00Z'),
            transaction_key: 2,
            unit_appuser_amount: 65.5,
            unit_settlement_amount: 65.5,
          },
        ],
        splitRows: [{ date: new Date('2024-02-01T00:00:00Z'), denominator: 1, financial_asset_key: 11, numerator: 4 }],
      }),
    });

    const result = await (portfolioHoldingsService as unknown as { getInvalidHoldings: (appuserKey: number, currency: string, portfolioId?: number) => Promise<unknown[]> }).getInvalidHoldings(1, 'USD', 7);

    expect(result).toHaveLength(0);
  });

  it('marks an oversell after split as invalid', async () => {
    Object.assign(DI.em, {
      getKysely: makeDatabaseMock({
        rawRows: [
          {
            financial_asset_currency_code: 'USD',
            financial_asset_key: 11,
            financial_asset_name: 'Apple Inc.',
            financial_asset_symbol: 'AAPL',
            financial_asset_type_name: 'Stock',
            financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.BUY,
            portfolio_key: 7,
            quantity: 2,
            remaining_batch: 0,
            transaction_date: new Date('2024-01-01T00:00:00Z'),
            transaction_key: 1,
            unit_appuser_amount: 65.5,
            unit_settlement_amount: 65.5,
          },
          {
            financial_asset_currency_code: 'USD',
            financial_asset_key: 11,
            financial_asset_name: 'Apple Inc.',
            financial_asset_symbol: 'AAPL',
            financial_asset_type_name: 'Stock',
            financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.SELL,
            portfolio_key: 7,
            quantity: -9,
            remaining_batch: null,
            transaction_date: new Date('2024-01-02T00:00:00Z'),
            transaction_key: 2,
            unit_appuser_amount: 65.5,
            unit_settlement_amount: 65.5,
          },
        ],
        splitRows: [{ date: new Date('2024-01-01T12:00:00Z'), denominator: 1, financial_asset_key: 11, numerator: 4 }],
      }),
    });

    const result = await (portfolioHoldingsService as unknown as { getInvalidHoldings: (appuserKey: number, currency: string, portfolioId?: number) => Promise<unknown[]> }).getInvalidHoldings(1, 'USD', 7);

    expect(result).toHaveLength(1);
  });

  it('preserves portfolio name and asset currency code from joined rows', async () => {
    Object.assign(DI.em, {
      getKysely: makeDatabaseMock({
      rawRows: [
        {
          financial_asset_currency_code: 'EUR',
          financial_asset_key: 22,
          financial_asset_name: 'Siemens',
          financial_asset_symbol: 'SIE',
          financial_asset_type_name: 'Stock',
          financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.BUY,
          portfolio_key: 3,
          portfolio_name: 'Core',
          quantity: 10,
          remaining_batch: 10,
          transaction_date: new Date('2024-01-01T00:00:00Z'),
          transaction_key: 1,
          unit_appuser_amount: 100,
          unit_settlement_amount: 100,
          },
          {
            financial_asset_currency_code: 'EUR',
            financial_asset_key: 22,
            financial_asset_name: 'Siemens',
            financial_asset_symbol: 'SIE',
            financial_asset_type_name: 'Stock',
            financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.SELL,
            portfolio_key: 3,
            portfolio_name: 'Core',
            quantity: -21,
            remaining_batch: null,
            transaction_date: new Date('2024-01-02T00:00:00Z'),
            transaction_key: 2,
            unit_appuser_amount: 100,
            unit_settlement_amount: 100,
          },
        ],
        splitRows: [{ date: new Date('2024-01-01T12:00:00Z'), denominator: 1, financial_asset_key: 22, numerator: 2 }],
      }),
    });

    const result = await (portfolioHoldingsService as unknown as { getInvalidHoldings: (appuserKey: number, currency: string, portfolioId?: number) => Promise<unknown[]> }).getInvalidHoldings(1, 'USD', 3);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      financialAssetCurrencyCode: 'EUR',
      portfolioName: 'Core',
    });
  });

  it('computes realized gains cost basis for a full sell after split', async () => {
    Object.assign(DI.em, {
      getKysely: makeDatabaseMock({
        rawRows: [
          { appuser_unit_amount: 10, financial_asset_currency_code: 'USD', financial_asset_key: 11, financial_asset_name: 'Apple Inc.', financial_asset_symbol: 'AAPL', financial_asset_type_name: 'Stock', financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.BUY, portfolio_key: 7, quantity: 2, settlement_unit_amount: 10, transaction_date: new Date('2024-01-01T00:00:00Z'), transaction_key: 1 },
          { appuser_unit_amount: 0, financial_asset_currency_code: 'USD', financial_asset_key: 11, financial_asset_name: 'Apple Inc.', financial_asset_symbol: 'AAPL', financial_asset_type_name: 'Stock', financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.SELL, portfolio_key: 7, quantity: -8, settlement_unit_amount: 0, transaction_date: new Date('2024-02-02T00:00:00Z'), transaction_key: 2 },
        ],
        splitRows: [{ date: new Date('2024-02-01T00:00:00Z'), denominator: 1, financial_asset_key: 11, numerator: 4 }],
      }),
    });

    const result = await portfolioHoldingsService.getRealizedGains(1, 7);

    expect(result.totalRealizedGains).toBe(-20);
  });

  it('computes realized gains cost basis for a partial sell after split', async () => {
    Object.assign(DI.em, {
      getKysely: makeDatabaseMock({
        rawRows: [
          { appuser_unit_amount: 10, financial_asset_currency_code: 'USD', financial_asset_key: 11, financial_asset_name: 'Apple Inc.', financial_asset_symbol: 'AAPL', financial_asset_type_name: 'Stock', financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.BUY, portfolio_key: 7, quantity: 2, settlement_unit_amount: 10, transaction_date: new Date('2024-01-01T00:00:00Z'), transaction_key: 1 },
          { appuser_unit_amount: 0, financial_asset_currency_code: 'USD', financial_asset_key: 11, financial_asset_name: 'Apple Inc.', financial_asset_symbol: 'AAPL', financial_asset_type_name: 'Stock', financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.SELL, portfolio_key: 7, quantity: -5, settlement_unit_amount: 0, transaction_date: new Date('2024-02-02T00:00:00Z'), transaction_key: 2 },
        ],
        splitRows: [{ date: new Date('2024-02-01T00:00:00Z'), denominator: 1, financial_asset_key: 11, numerator: 4 }],
      }),
    });

    const result = await portfolioHoldingsService.getRealizedGains(1, 7);

    expect(result.totalRealizedGains).toBe(-12.5);
  });

  it('falls back to settlement_amount when appuser_settlement_amount is null', async () => {
    Object.assign(DI.em, {
      getKysely: makeDatabaseMock({
        rawRows: [
          { appuser_unit_amount: 97, financial_asset_currency_code: 'EUR', financial_asset_key: 1, financial_asset_name: 'AMD', financial_asset_symbol: 'AMD', financial_asset_type_name: 'Stock', financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.BUY, portfolio_key: 42, quantity: 5, settlement_unit_amount: 97, transaction_date: new Date('2024-01-01T00:00:00Z'), transaction_key: 1 },
          { appuser_unit_amount: 150, financial_asset_currency_code: 'EUR', financial_asset_key: 2, financial_asset_name: 'Apple Inc.', financial_asset_symbol: 'AAPL', financial_asset_type_name: 'Stock', financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.BUY, portfolio_key: 42, quantity: 10, settlement_unit_amount: 150, transaction_date: new Date('2024-01-02T00:00:00Z'), transaction_key: 2 },
          { appuser_settlement_amount: null, financial_asset_currency_code: 'EUR', financial_asset_key: 2, financial_asset_name: 'Apple Inc.', financial_asset_symbol: 'AAPL', financial_asset_type_name: 'Stock', financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.SELL, portfolio_key: 42, quantity: -2, settlement_amount: -364, settlement_unit_amount: 182, transaction_date: new Date('2024-01-03T00:00:00Z'), transaction_key: 3 },
        ],
        splitRows: [],
      }),
    });

    const result = await portfolioHoldingsService.getRealizedGains(1, 42);

    expect(result.totalRealizedGains).toBe(64);
  });

  it('prefers appuser_settlement_amount when both appuser and settlement amounts are present', async () => {
    const getKysely = makeDatabaseMock({
      rawRows: [
        { appuser_unit_amount: 100, financial_asset_currency_code: 'EUR', financial_asset_key: 2, financial_asset_name: 'Apple Inc.', financial_asset_symbol: 'AAPL', financial_asset_type_name: 'Stock', financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.BUY, portfolio_key: 42, quantity: 1, settlement_unit_amount: 100, transaction_date: new Date('2024-01-01T00:00:00Z'), transaction_key: 1 },
        { appuser_settlement_amount: 150, financial_asset_currency_code: 'EUR', financial_asset_key: 2, financial_asset_name: 'Apple Inc.', financial_asset_symbol: 'AAPL', financial_asset_type_name: 'Stock', financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.SELL, portfolio_key: 42, quantity: -1, settlement_amount: -364, settlement_unit_amount: 364, transaction_date: new Date('2024-01-02T00:00:00Z'), transaction_key: 2 },
      ],
      splitRows: [],
    });

    Object.assign(DI.em, { getKysely });

    const result = await portfolioHoldingsService.getRealizedGains(1, 42);

    expect(result.totalRealizedGains).toBe(50);
  });

  it('subtracts trade commissions from FIFO basis and realized sale proceeds', async () => {
    Object.assign(DI.em, {
      getKysely: makeDatabaseMock({
        rawRows: [
          { appuser_currency_code: 'EUR', appuser_unit_amount: 85.25, fee_amount: 1, fee_currency_code: 'EUR', financial_asset_currency_code: 'EUR', financial_asset_key: 1, financial_asset_name: 'ETF', financial_asset_symbol: 'ETF', financial_asset_type_name: 'ETF', financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.BUY, portfolio_key: 42, quantity: 12, settlement_currency_code: 'EUR', settlement_unit_amount: 85.25, transaction_date: new Date('2024-01-01T00:00:00Z'), transaction_key: 1 },
          { appuser_currency_code: 'EUR', appuser_unit_amount: 89.62, fee_amount: 1, fee_currency_code: 'EUR', financial_asset_currency_code: 'EUR', financial_asset_key: 1, financial_asset_name: 'ETF', financial_asset_symbol: 'ETF', financial_asset_type_name: 'ETF', financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.BUY, portfolio_key: 42, quantity: 11, settlement_currency_code: 'EUR', settlement_unit_amount: 89.62, transaction_date: new Date('2024-02-01T00:00:00Z'), transaction_key: 2 },
          { appuser_currency_code: 'EUR', appuser_unit_amount: 93.45, fee_amount: 1, fee_currency_code: 'EUR', financial_asset_currency_code: 'EUR', financial_asset_key: 1, financial_asset_name: 'ETF', financial_asset_symbol: 'ETF', financial_asset_type_name: 'ETF', financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.BUY, portfolio_key: 42, quantity: 8, settlement_currency_code: 'EUR', settlement_unit_amount: 93.45, transaction_date: new Date('2024-03-01T00:00:00Z'), transaction_key: 3 },
          { appuser_currency_code: 'EUR', appuser_settlement_amount: 3444, fee_amount: -3, fee_currency_code: 'EUR', financial_asset_currency_code: 'EUR', financial_asset_key: 1, financial_asset_name: 'ETF', financial_asset_symbol: 'ETF', financial_asset_type_name: 'ETF', financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.SELL, portfolio_key: 42, quantity: -28, settlement_amount: -3444, settlement_currency_code: 'EUR', settlement_unit_amount: 123, transaction_date: new Date('2024-04-01T00:00:00Z'), transaction_key: 4 },
        ],
        splitRows: [],
      }),
    });

    const result = await portfolioHoldingsService.getRealizedGains(1, 42);

    expect(result.totalCostBasisOfSold).toBeCloseTo(2478.695, 8);
    expect(result.totalRealizedGains).toBeCloseTo(962.305, 8);
  });

  it('converts settlement-currency fees with each transaction stored FX rate', async () => {
    const rawRows = [
      { appuser_currency_code: 'EUR', appuser_currency_exchange_rate: 0.8, appuser_unit_amount: 80, fee_amount: 10, fee_currency_code: 'USD', fee_currency_key: 1, financial_asset_currency_code: 'USD', financial_asset_key: 1, financial_asset_name: 'ETF', financial_asset_symbol: 'ETF', financial_asset_type_name: 'ETF', financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.BUY, portfolio_key: 42, quantity: 2, settlement_amount: -200, settlement_currency_code: 'USD', settlement_currency_key: 1, settlement_unit_amount: 100, transaction_date: new Date('2024-01-01T00:00:00Z'), transaction_key: 1 },
      { appuser_currency_code: 'EUR', appuser_currency_exchange_rate: 0.9, appuser_settlement_amount: 135, fee_amount: -2, fee_currency_code: 'USD', fee_currency_key: 1, financial_asset_currency_code: 'USD', financial_asset_key: 1, financial_asset_name: 'ETF', financial_asset_symbol: 'ETF', financial_asset_type_name: 'ETF', financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.SELL, portfolio_key: 42, quantity: -1, settlement_amount: -150, settlement_currency_code: 'USD', settlement_currency_key: 1, settlement_unit_amount: 150, transaction_date: new Date('2024-02-01T00:00:00Z'), transaction_key: 2 },
    ];
    Object.assign(DI.em, { getKysely: makeDatabaseMock({ rawRows }) });

    const gains = await portfolioHoldingsService.getRealizedGains(1, 42);
    const holdings = await portfolioHoldingsService.getPortfolioHoldings({ appuserKey: 1, currencyKey: { code: 'EUR' } } as Appuser, 42);

    expect(gains.totalCostBasisOfSold).toBe(84);
    expect(gains.totalCostBasisOfSold + gains.totalRealizedGains).toBeCloseTo(133.2, 8);
    expect(gains.totalRealizedGains).toBeCloseTo(49.2, 8);
    expect(holdings[0]).toMatchObject({ averageBuyPrice: 84, quantity: 1 });
  });

  it('uses the latest historical rate on or before the fee transaction date for third-currency fees', async () => {
    Object.assign(DI.em, {
      getKysely: makeDatabaseMock({
        exchangeRateRows: [
          { date: new Date('2024-01-01T00:00:00Z'), rate: 0.5 },
          { date: new Date('2024-02-01T00:00:00Z'), rate: 0.99 },
        ],
        rawRows: [
          { appuser_currency_code: 'EUR', appuser_currency_key: 2, appuser_unit_amount: 100, fee_amount: 10, fee_currency_code: 'GBP', fee_currency_key: 3, financial_asset_currency_code: 'USD', financial_asset_key: 1, financial_asset_name: 'ETF', financial_asset_symbol: 'ETF', financial_asset_type_name: 'ETF', financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.BUY, portfolio_key: 42, quantity: 1, settlement_currency_code: 'USD', settlement_currency_key: 1, settlement_unit_amount: 100, transaction_date: new Date('2024-01-15T00:00:00Z'), transaction_key: 1 },
          { appuser_currency_code: 'EUR', appuser_settlement_amount: 200, financial_asset_currency_code: 'USD', financial_asset_key: 1, financial_asset_name: 'ETF', financial_asset_symbol: 'ETF', financial_asset_type_name: 'ETF', financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.SELL, portfolio_key: 42, quantity: -1, settlement_amount: -200, settlement_currency_code: 'USD', settlement_currency_key: 1, settlement_unit_amount: 200, transaction_date: new Date('2024-03-01T00:00:00Z'), transaction_key: 2 },
        ],
        splitRows: [],
      }),
    });

    const result = await portfolioHoldingsService.getRealizedGains(1, 42);

    expect(result.totalCostBasisOfSold).toBe(105);
    expect(result.totalRealizedGains).toBe(95);
  });

  it('converts original-currency fees through stored original-to-settlement and settlement-to-user rates', async () => {
    Object.assign(DI.em, {
      getKysely: makeDatabaseMock({
        rawRows: [
          { appuser_currency_code: 'EUR', appuser_currency_exchange_rate: 0.8, appuser_unit_amount: 80, fee_amount: 1000, fee_currency_code: 'JPY', fee_currency_key: 3, financial_asset_currency_code: 'USD', financial_asset_key: 1, financial_asset_name: 'ETF', financial_asset_symbol: 'ETF', financial_asset_type_name: 'ETF', financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.BUY, original_currency_code: 'JPY', portfolio_key: 42, quantity: 1, settlement_currency_code: 'USD', settlement_currency_key: 1, settlement_exchange_rate: 0.01, settlement_unit_amount: 100, transaction_date: new Date('2024-01-15T00:00:00Z'), transaction_key: 1 },
          { appuser_currency_code: 'EUR', appuser_settlement_amount: 100, financial_asset_currency_code: 'USD', financial_asset_key: 1, financial_asset_name: 'ETF', financial_asset_symbol: 'ETF', financial_asset_type_name: 'ETF', financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.SELL, portfolio_key: 42, quantity: -1, settlement_amount: -125, settlement_currency_code: 'USD', settlement_currency_key: 1, settlement_unit_amount: 125, transaction_date: new Date('2024-02-15T00:00:00Z'), transaction_key: 2 },
        ],
        splitRows: [],
      }),
    });

    const result = await portfolioHoldingsService.getRealizedGains(1, 42);

    expect(result.totalCostBasisOfSold).toBe(88);
    expect(result.totalRealizedGains).toBe(12);
  });

  it('keeps zero-valued fees independent of fee currency and FX availability', async () => {
    Object.assign(DI.em, {
      getKysely: makeDatabaseMock({
        rawRows: [
          { appuser_currency_code: 'EUR', appuser_unit_amount: 100, fee_amount: 0, financial_asset_currency_code: 'USD', financial_asset_key: 1, financial_asset_name: 'ETF', financial_asset_symbol: 'ETF', financial_asset_type_name: 'ETF', financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.BUY, portfolio_key: 42, quantity: 1, settlement_currency_code: 'USD', settlement_unit_amount: 100, transaction_date: new Date('2024-01-15T00:00:00Z'), transaction_key: 1 },
        ],
        splitRows: [],
      }),
    });

    const result = await portfolioHoldingsService.getRealizedGains(1, 42);

    expect(result).toEqual({ totalCostBasisOfSold: 0, totalRealizedGains: 0 });
  });

  describe('a fee with no usable exchange rate', () => {
    const unconvertibleBuy = {
      appuser_currency_code: 'EUR', appuser_currency_key: 2, appuser_unit_amount: 100, fee_amount: 10, financial_asset_currency_code: 'USD', financial_asset_key: 1, financial_asset_name: 'ETF', financial_asset_symbol: 'ETF', financial_asset_type_name: 'ETF', financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.BUY, portfolio_key: 42, quantity: 2, settlement_currency_code: 'USD', settlement_currency_key: 1, settlement_unit_amount: 100, transaction_date: new Date('2024-01-15T00:00:00Z'), transaction_key: 1,
    };
    const sellOne = { appuser_currency_code: 'EUR', appuser_settlement_amount: 150, financial_asset_currency_code: 'USD', financial_asset_key: 1, financial_asset_name: 'ETF', financial_asset_symbol: 'ETF', financial_asset_type_name: 'ETF', financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.SELL, portfolio_key: 42, quantity: -1, settlement_amount: -150, settlement_currency_code: 'USD', settlement_currency_key: 1, settlement_unit_amount: 150, transaction_date: new Date('2024-02-15T00:00:00Z'), transaction_key: 2 };
    const otherAssetWithEurFee = { appuser_currency_code: 'EUR', appuser_unit_amount: 50, fee_amount: 1, fee_currency_code: 'EUR', financial_asset_currency_code: 'EUR', financial_asset_key: 2, financial_asset_name: 'Other', financial_asset_symbol: 'OTH', financial_asset_type_name: 'ETF', financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.BUY, portfolio_key: 42, quantity: 1, settlement_currency_code: 'EUR', settlement_unit_amount: 50, transaction_date: new Date('2024-01-15T00:00:00Z'), transaction_key: 3 };

    it.each([
      { case: 'a third-currency fee with no historical rate', fields: { fee_currency_code: 'GBP', fee_currency_key: 3 } },
      { case: 'a settlement-currency fee with no stored rate', fields: { appuser_currency_exchange_rate: null, fee_currency_code: 'USD', fee_currency_key: 1, original_currency_code: 'GBP', settlement_exchange_rate: 0.9 } },
      { case: 'an original-currency fee with no stored rate', fields: { appuser_currency_exchange_rate: 0.9, fee_currency_code: 'GBP', fee_currency_key: 3, original_currency_code: 'GBP', settlement_exchange_rate: null } },
      ...[0, -0.5, Number.NaN, Number.POSITIVE_INFINITY, 'invalid'].map((rate) => ({ case: `a stored rate of ${String(rate)}`, fields: { appuser_currency_exchange_rate: rate, fee_currency_code: 'USD', fee_currency_key: 1 } })),
      { case: 'a fee with no fee currency', fields: { fee_currency_code: undefined } },
    ])('counts $case as zero, flags only that asset and warns', async ({ fields }) => {
      Object.assign(DI.em, { getKysely: makeDatabaseMock({ rawRows: [{ ...unconvertibleBuy, ...fields }, sellOne, otherAssetWithEurFee], splitRows: [] }) });
      getCurrentAssetPricesMock.mockResolvedValue([]);
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      const gains = await portfolioHoldingsService.getRealizedGains(1, 42);
      const holdings = await portfolioHoldingsService.getPortfolioHoldings({ appuserKey: 1, currencyKey: { code: 'EUR' } } as Appuser, 42);

      expect(gains).toEqual({ feeConversionIncompleteAssetKeys: [1], totalCostBasisOfSold: 100, totalRealizedGains: 50 });
      expect(holdings.find((h) => h.financialAssetKey === 1)).toMatchObject({ averageBuyPrice: 100, feeConversionIncomplete: true, quantity: 1 });
      const other = holdings.find((h) => h.financialAssetKey === 2);
      expect(other).toMatchObject({ averageBuyPrice: 51, quantity: 1 });
      expect(other).not.toHaveProperty('feeConversionIncomplete');
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it('still reports an asset that was fully sold, which has no holding left to carry the flag', async () => {
      const sellBoth = { ...sellOne, appuser_settlement_amount: 300, quantity: -2, settlement_amount: -300 };
      Object.assign(DI.em, { getKysely: makeDatabaseMock({ rawRows: [{ ...unconvertibleBuy, fee_currency_code: 'GBP', fee_currency_key: 3 }, sellBoth, otherAssetWithEurFee], splitRows: [] }) });
      getCurrentAssetPricesMock.mockResolvedValue([]);
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      const gains = await portfolioHoldingsService.getRealizedGains(1, 42);
      const holdings = await portfolioHoldingsService.getPortfolioHoldings({ appuserKey: 1, currencyKey: { code: 'EUR' } } as Appuser, 42);

      expect(gains).toEqual({ feeConversionIncompleteAssetKeys: [1], totalCostBasisOfSold: 200, totalRealizedGains: 100 });
      expect(holdings.some((h) => h.feeConversionIncomplete)).toBe(false);
      warn.mockRestore();
    });
  });

  it('preserves exact fee allocation across partial sales in public holdings and realized gains', async () => {
    const rawRows = [
      { appuser_currency_code: 'USD', appuser_unit_amount: 99.99, fee_amount: 0.01, fee_currency_code: 'USD', fee_currency_key: 1, financial_asset_currency_code: 'USD', financial_asset_key: 1, financial_asset_name: 'ETF', financial_asset_symbol: 'ETF', financial_asset_type_name: 'ETF', financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.BUY, portfolio_key: 42, quantity: 2, settlement_currency_code: 'USD', settlement_currency_key: 1, settlement_unit_amount: 99.99, transaction_date: new Date('2024-01-01T00:00:00Z'), transaction_key: 1 },
      { appuser_currency_code: 'USD', appuser_settlement_amount: 120, fee_amount: 0, fee_currency_code: 'USD', fee_currency_key: 1, financial_asset_currency_code: 'USD', financial_asset_key: 1, financial_asset_name: 'ETF', financial_asset_symbol: 'ETF', financial_asset_type_name: 'ETF', financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.SELL, portfolio_key: 42, quantity: -1, settlement_amount: -120, settlement_currency_code: 'USD', settlement_currency_key: 1, settlement_unit_amount: 120, transaction_date: new Date('2024-01-02T00:00:00Z'), transaction_key: 2 },
    ];
    Object.assign(DI.em, { getKysely: makeDatabaseMock({ rawRows }) });
    getCurrentAssetPricesMock.mockResolvedValue([{ financial_asset_key: 1, price: 120 }]);

    const holdings = await portfolioHoldingsService.getPortfolioHoldings({ appuserKey: 1, currencyKey: { code: 'USD' } } as Appuser, 42);
    const gains = await portfolioHoldingsService.getRealizedGains(1, 42);

    expect(holdings[0]).toMatchObject({ averageBuyPrice: 99.995, currentValue: 120, quantity: 1, unrealizedGains: 20 });
    expect(gains.totalCostBasisOfSold).toBeCloseTo(99.995, 12);
    expect(gains.totalRealizedGains).toBeCloseTo(20.005, 12);
  });

  it('keeps a negative net sale proceeds when the commission exceeds gross proceeds', async () => {
    Object.assign(DI.em, {
      getKysely: makeDatabaseMock({
        rawRows: [
          { appuser_currency_code: 'EUR', appuser_unit_amount: 10, financial_asset_currency_code: 'EUR', financial_asset_key: 1, financial_asset_name: 'ETF', financial_asset_symbol: 'ETF', financial_asset_type_name: 'ETF', financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.BUY, portfolio_key: 42, quantity: 1, settlement_currency_code: 'EUR', settlement_unit_amount: 10, transaction_date: new Date('2024-01-01T00:00:00Z'), transaction_key: 1 },
          { appuser_currency_code: 'EUR', appuser_settlement_amount: 1, fee_amount: 3, fee_currency_code: 'EUR', financial_asset_currency_code: 'EUR', financial_asset_key: 1, financial_asset_name: 'ETF', financial_asset_symbol: 'ETF', financial_asset_type_name: 'ETF', financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.SELL, portfolio_key: 42, quantity: -1, settlement_amount: -1, settlement_currency_code: 'EUR', settlement_unit_amount: 1, transaction_date: new Date('2024-02-01T00:00:00Z'), transaction_key: 2 },
        ],
        splitRows: [],
      }),
    });

    const result = await portfolioHoldingsService.getRealizedGains(1, 42);

    expect(result.totalCostBasisOfSold).toBe(10);
    expect(result.totalRealizedGains).toBe(-12);
  });

});

describe('Savings Certificate holdings integration', () => {
  const stockRow = {
    financial_asset_currency_code: 'EUR',
    financial_asset_key: 1,
    financial_asset_name: 'Apple Inc.',
    financial_asset_symbol: 'AAPL',
    financial_asset_type_name: 'Stock',
    financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.BUY,
    portfolio_key: 7,
    quantity: 10,
    settlement_unit_amount: 100,
    transaction_date: new Date('2024-01-01T00:00:00Z'),
    transaction_key: 1,
  };

  const savingsCertificateRow = {
    fee_amount: 25,
    fee_currency_code: 'EUR',
    financial_asset_currency_code: 'EUR',
    financial_asset_key: 100,
    financial_asset_name: 'Certificado de Aforro — Série F',
    financial_asset_symbol: 'CA-SERIE-F',
    financial_asset_type_name: 'Savings Certificate',
    financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.BUY,
    portfolio_key: 7,
    quantity: 1000,
    settlement_unit_amount: 1,
    transaction_date: new Date('2024-01-01T00:00:00Z'),
    transaction_key: 2,
  };

  it('values the Savings Certificate holding via accrual (not price lookup) and recomputes allocation across the combined portfolio', async () => {
    getCurrentAssetPricesMock.mockResolvedValueOnce([{ date: new Date('2024-01-01'), financial_asset_key: 1, price: 150 }]);
    Object.assign(DI.em, {
      getKysely: makeDatabaseMock({
        caPremiumRows: caStandardPremiumRows,
        caRateRows: caWideRateRows,
        rawRows: [stockRow, savingsCertificateRow],
      }),
    });

    const result = await portfolioHoldingsService.getPortfolioHoldings({ appuserKey: 1, currencyKey: { code: 'EUR' } } as Appuser, 7);

    expect(result).toHaveLength(2);
    const stock = result.find((h) => h.financialAssetSymbol === 'AAPL');
    const certificate = result.find((h) => h.financialAssetSymbol === 'CA-SERIE-F');

    expect(stock).toBeDefined();
    expect(certificate).toBeDefined();

    // Stock is priced via the price-lookup path: 10 units @ 150.
    expect(stock!.currentValue).toBe(1500);
    // Certificate is valued via accrual, not price lookup — no currentPrice, principal (1000) plus interest.
    expect(certificate!.currentPrice).toBeNull();
    expect(certificate!.currentValue).toBeGreaterThan(1000);
    expect(certificate!.averageBuyPrice).toBe(1);
    expect(certificate!.certificadoAforroDetail).toBeDefined();
    expect(certificate!.certificadoAforroDetail!.lots).toHaveLength(1);

    // Allocation must be recomputed across BOTH holdings, not just the price-enriched ones —
    // otherwise the stock holding would show 100% (its own-scope total) instead of its true share.
    const expectedStockAllocation = (1500 / (1500 + certificate!.currentValue!)) * 100;
    expect(stock!.allocation).toBeCloseTo(expectedStockAllocation, 5);
    expect((stock!.allocation ?? 0) + (certificate!.allocation ?? 0)).toBeCloseTo(100, 5);
    expect(stock!.allocation).toBeLessThan(100);
  });

  it('leaves a stock-only portfolio completely unaffected (regression guard)', async () => {
    Object.assign(DI.em, {
      getKysely: makeDatabaseMock({
        rawRows: [
          {
            appuser_unit_amount: 65.5,
            financial_asset_currency_code: 'USD',
            financial_asset_key: 11,
            financial_asset_name: 'Apple Inc.',
            financial_asset_symbol: 'AAPL',
            financial_asset_type_name: 'Stock',
            financial_transaction_type_key: FINANCIAL_TRANSACTION_TYPES.BUY,
            portfolio_key: 7,
            portfolio_name: 'Primary',
            quantity: 2,
            settlement_unit_amount: 65.5,
            transaction_date: new Date('2024-01-01T00:00:00Z'),
            transaction_key: 1,
          },
        ],
      }),
    });

    const result = await portfolioHoldingsService.getPortfolioHoldings({ appuserKey: 1, currencyKey: { code: 'USD' } } as Appuser, 7);

    expect(result).toHaveLength(1);
    expect(result[0]!.certificadoAforroDetail).toBeUndefined();
    expect(result[0]).toMatchObject({
      averageBuyPrice: 65.5,
      financialAssetSymbol: 'AAPL',
      quantity: 2,
    });
  });

  it('degrades gracefully when a Savings Certificate lot fails valuation (no rate periods): the rest of the portfolio still returns successfully', async () => {
    getCurrentAssetPricesMock.mockResolvedValueOnce([{ date: new Date('2024-01-01'), financial_asset_key: 1, price: 150 }]);
    Object.assign(DI.em, {
      getKysely: makeDatabaseMock({
        // No caRateRows at all for financial_asset_key 100 — computeCertificateLotValue throws
        // internally ("no rate period available"); the try/catch in
        // enrichSavingsCertificateHoldings must swallow it rather than letting the whole
        // getPortfolioHoldings() call reject.
        caPremiumRows: caStandardPremiumRows,
        caRateRows: [],
        rawRows: [stockRow, savingsCertificateRow],
      }),
    });

    // Awaiting this without it rejecting IS the proof of graceful degradation — a throw inside
    // enrichSavingsCertificateHoldings that escaped the try/catch would reject this promise and
    // fail the test.
    const result = await portfolioHoldingsService.getPortfolioHoldings({ appuserKey: 1, currencyKey: { code: 'EUR' } } as Appuser, 7);

    // The broken CA lot is skipped entirely (no holding surfaced for it); the stock holding is
    // unaffected and its allocation reflects it being the only valued holding.
    expect(result).toHaveLength(1);
    expect(result[0]!.financialAssetSymbol).toBe('AAPL');
    expect(result[0]!.allocation).toBeCloseTo(100, 5);
  });
});
