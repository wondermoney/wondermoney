import { describe, expect, it } from 'vitest';

import { FINANCIAL_TRANSACTION_TYPES } from '@app/constants/financial-transaction-types';
import { PortfolioCostBasisMethod } from '@app/constants/portfolio-cost-basis';

import {
  aggregateBatchesIntoAssets,
  type HoldingTimelineItem,
  type HoldingTransactionTimelineItem,
  replayHoldingTimeline,
  type StockSplitTimelineItem,
} from '../portfolio-holdings.utils';

/*
 * Cost basis methods, table-driven.
 *
 * `replayHoldingTimeline` is the single place a sale relieves cost. FIFO consumes the oldest
 * lots; AVERAGE relieves the running average of the open position and leaves that average
 * unchanged. Every caller (holdings, realized gains, snapshots) reads the same replay, so these
 * are the numbers a user's realized and unrealized gains are built from.
 */

const BUY = FINANCIAL_TRANSACTION_TYPES.BUY;
const SELL = FINANCIAL_TRANSACTION_TYPES.SELL;

function buy(transactionKey: number, day: string, quantity: number, unitPrice: number, extra: Partial<HoldingTransactionTimelineItem> = {}) {
  return transaction({
    financial_transaction_type_key: BUY,
    quantity,
    transaction_date: new Date(`${day}T00:00:00Z`),
    transaction_key: transactionKey,
    unit_settlement_amount: unitPrice,
    ...extra,
  });
}

function sell(transactionKey: number, day: string, quantity: number, extra: Partial<HoldingTransactionTimelineItem> = {}) {
  return transaction({
    financial_transaction_type_key: SELL,
    quantity,
    transaction_date: new Date(`${day}T00:00:00Z`),
    transaction_key: transactionKey,
    unit_settlement_amount: 0,
    ...extra,
  });
}

function split(day: string, numerator: number, denominator: number): StockSplitTimelineItem {
  return {
    date: new Date(`${day}T00:00:00Z`),
    denominator,
    financial_asset_key: 1,
    itemType: 'SPLIT',
    numerator,
  };
}

function transaction(
  overrides: Partial<HoldingTransactionTimelineItem> & Pick<HoldingTransactionTimelineItem, 'quantity' | 'transaction_date' | 'transaction_key'>,
): HoldingTransactionTimelineItem {
  return {
    financial_asset_key: 1,
    financial_asset_name: 'Apple',
    financial_asset_symbol: 'AAPL',
    financial_asset_type_name: 'Stock',
    financial_transaction_type_key: BUY,
    itemType: 'TRANSACTION',
    portfolio_key: 1,
    unit_settlement_amount: 0,
    ...overrides,
  };
}

/** What the holdings service reports for the open position: quantity and weighted unit cost. */
function openPosition(items: HoldingTimelineItem[], method: PortfolioCostBasisMethod) {
  const assets = aggregateBatchesIntoAssets(replayHoldingTimeline(items, method).openBatches);
  return assets[0] ? { averageBuyPrice: assets[0].averageBuyPrice, quantity: assets[0].quantity } : null;
}

function realized(items: HoldingTimelineItem[], method: PortfolioCostBasisMethod) {
  return replayHoldingTimeline(items, method).realizedCostBasisByPortfolioAsset.get('1:1') ?? 0;
}

describe('replayHoldingTimeline cost basis methods', () => {
  it('keeps FIFO as the default', () => {
    const items = [buy(1, '2024-01-01', 10, 100), buy(2, '2024-02-01', 10, 200), sell(3, '2024-03-01', 10)];

    expect(replayHoldingTimeline(items)).toEqual(replayHoldingTimeline(items, PortfolioCostBasisMethod.FIFO));
  });

  it.each([
    {
      expectedAverage: 150,
      expectedQuantity: 10,
      expectedRealized: 1500,
      label: 'the acceptance example: 10 at 100, 10 at 200, sell 10',
      method: PortfolioCostBasisMethod.AVERAGE,
      timeline: [buy(1, '2024-01-01', 10, 100), buy(2, '2024-02-01', 10, 200), sell(3, '2024-03-01', 10)],
    },
    {
      expectedAverage: 200,
      expectedQuantity: 10,
      expectedRealized: 1000,
      label: 'the acceptance example under FIFO',
      method: PortfolioCostBasisMethod.FIFO,
      timeline: [buy(1, '2024-01-01', 10, 100), buy(2, '2024-02-01', 10, 200), sell(3, '2024-03-01', 10)],
    },
    {
      expectedAverage: 150,
      expectedQuantity: 10,
      expectedRealized: 1500,
      label: 'two partial sells at the same running average',
      method: PortfolioCostBasisMethod.AVERAGE,
      timeline: [buy(1, '2024-01-01', 10, 100), buy(2, '2024-02-01', 10, 200), sell(3, '2024-03-01', 5), sell(4, '2024-04-01', 5)],
    },
    {
      expectedAverage: 200,
      expectedQuantity: 10,
      expectedRealized: 1000,
      label: 'two partial sells that both come out of the oldest FIFO lot',
      method: PortfolioCostBasisMethod.FIFO,
      timeline: [buy(1, '2024-01-01', 10, 100), buy(2, '2024-02-01', 10, 200), sell(3, '2024-03-01', 5), sell(4, '2024-04-01', 5)],
    },
    {
      expectedAverage: 100,
      expectedQuantity: 20,
      expectedRealized: 1000,
      label: 'a 2:1 split between buys pools the split-adjusted cost',
      method: PortfolioCostBasisMethod.AVERAGE,
      timeline: [buy(1, '2024-01-01', 10, 100), split('2024-01-15', 2, 1), buy(2, '2024-02-01', 10, 200), sell(3, '2024-03-01', 10)],
    },
    {
      expectedAverage: 125,
      expectedQuantity: 20,
      expectedRealized: 500,
      label: 'a 2:1 split between buys sells the oldest split-adjusted FIFO lot first',
      method: PortfolioCostBasisMethod.FIFO,
      timeline: [buy(1, '2024-01-01', 10, 100), split('2024-01-15', 2, 1), buy(2, '2024-02-01', 10, 200), sell(3, '2024-03-01', 10)],
    },
    {
      expectedAverage: 150.25,
      expectedQuantity: 10,
      expectedRealized: 1502.5,
      label: 'a buy fee (already converted to the accounting currency) is part of the pool',
      method: PortfolioCostBasisMethod.AVERAGE,
      timeline: [
        buy(1, '2024-01-01', 10, 100),
        buy(2, '2024-02-01', 10, 200, { fee_amount: 5 }),
        sell(3, '2024-03-01', 10),
      ],
    },
    {
      expectedAverage: 200.5,
      expectedQuantity: 10,
      expectedRealized: 1000,
      label: 'a buy fee stays on its FIFO lot',
      method: PortfolioCostBasisMethod.FIFO,
      timeline: [
        buy(1, '2024-01-01', 10, 100),
        buy(2, '2024-02-01', 10, 200, { fee_amount: 5 }),
        sell(3, '2024-03-01', 10),
      ],
    },
    {
      expectedAverage: 150,
      expectedQuantity: 16,
      expectedRealized: 600,
      label: 'a sell that only partly drains the pool leaves the average unchanged',
      method: PortfolioCostBasisMethod.AVERAGE,
      timeline: [buy(1, '2024-01-01', 10, 100), buy(2, '2024-02-01', 10, 200), sell(3, '2024-03-01', 4)],
    },
    {
      expectedAverage: 162.5,
      expectedQuantity: 16,
      expectedRealized: 400,
      label: 'a partial FIFO sell leaves the newer lot untouched',
      method: PortfolioCostBasisMethod.FIFO,
      timeline: [buy(1, '2024-01-01', 10, 100), buy(2, '2024-02-01', 10, 200), sell(3, '2024-03-01', 4)],
    },
  ])('$label', ({ expectedAverage, expectedQuantity, expectedRealized, method, timeline }) => {
    expect(realized(timeline, method)).toBeCloseTo(expectedRealized, 6);
    expect(openPosition(timeline, method)).toEqual({ averageBuyPrice: expectedAverage, quantity: expectedQuantity });
  });

  it('keeps separate pools per portfolio and asset', () => {
    const items = [
      buy(1, '2024-01-01', 10, 100),
      buy(2, '2024-02-01', 10, 200, { portfolio_key: 2 }),
      sell(3, '2024-03-01', 5, { portfolio_key: 2 }),
    ];

    const result = replayHoldingTimeline(items, PortfolioCostBasisMethod.AVERAGE);

    expect(result.realizedCostBasisByPortfolioAsset.get('1:1')).toBeUndefined();
    expect(result.realizedCostBasisByPortfolioAsset.get('2:1')).toBeCloseTo(1000, 6);
    expect(aggregateBatchesIntoAssets(result.openBatches.filter((batch) => batch.portfolio_key === 1))).toEqual([
      expect.objectContaining({ averageBuyPrice: 100, quantity: 10 }),
    ]);
    expect(aggregateBatchesIntoAssets(result.openBatches.filter((batch) => batch.portfolio_key === 2))).toEqual([
      expect.objectContaining({ averageBuyPrice: 200, quantity: 5 }),
    ]);
  });

  it('still reports an oversell under AVERAGE without inventing cost', () => {
    const result = replayHoldingTimeline(
      [buy(1, '2024-01-01', 10, 100), sell(2, '2024-02-01', 15)],
      PortfolioCostBasisMethod.AVERAGE,
    );

    expect(result.oversoldByPortfolioAsset.get('1:1')).toBeCloseTo(5, 6);
    expect(result.realizedCostBasisByPortfolioAsset.get('1:1')).toBeCloseTo(1000, 6);
    expect(result.openBatches).toHaveLength(0);
  });
});
