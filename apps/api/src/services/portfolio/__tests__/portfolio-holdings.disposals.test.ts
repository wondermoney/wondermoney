import { describe, expect, it } from 'vitest';

import { FINANCIAL_TRANSACTION_TYPES } from '@app/constants/financial-transaction-types';
import { PortfolioCostBasisMethod } from '@app/constants/portfolio-cost-basis';

import {
  type HoldingTimelineItem,
  type HoldingTransactionTimelineItem,
  replayHoldingTimeline,
  type StockSplitTimelineItem,
} from '../portfolio-holdings.utils';

/*
 * One disposal per sale, out of the same replay that relieves cost for holdings and the
 * portfolio's realized total. Each sale's proceeds (net of its fee), the cost it relieved and
 * their difference are what a user files per sale; the oldest lot it consumed starts its holding
 * period.
 */

const BUY = FINANCIAL_TRANSACTION_TYPES.BUY;
const SELL = FINANCIAL_TRANSACTION_TYPES.SELL;

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

const at = (day: string) => new Date(`${day}T00:00:00Z`);

function buy(transactionKey: number, day: string, quantity: number, unitPrice: number, extra: Partial<HoldingTransactionTimelineItem> = {}) {
  return transaction({ financial_transaction_type_key: BUY, quantity, transaction_date: at(day), transaction_key: transactionKey, unit_settlement_amount: unitPrice, ...extra });
}

/** A sale of `quantity` at `unitPrice`; its proceeds are the recorded settlement amount. */
function sell(transactionKey: number, day: string, quantity: number, unitPrice: number, extra: Partial<HoldingTransactionTimelineItem> = {}) {
  return transaction({
    financial_transaction_type_key: SELL,
    proceeds_amount: quantity * unitPrice,
    quantity,
    transaction_date: at(day),
    transaction_key: transactionKey,
    unit_settlement_amount: unitPrice,
    ...extra,
  });
}

function split(day: string, numerator: number, denominator: number): StockSplitTimelineItem {
  return { date: at(day), denominator, financial_asset_key: 1, itemType: 'SPLIT', numerator };
}

const disposals = (items: HoldingTimelineItem[], method = PortfolioCostBasisMethod.FIFO) => replayHoldingTimeline(items, method).disposals;

describe('replayHoldingTimeline disposals', () => {
  it('relieves the oldest lots per sale under FIFO', () => {
    const result = disposals([
      buy(1, '2024-01-01', 10, 100),
      buy(2, '2024-02-01', 10, 200),
      sell(3, '2024-03-01', 15, 250),
      sell(4, '2024-04-01', 5, 180),
    ]);

    expect(result).toEqual([
      expect.objectContaining({ costBasis: 2000, holdingPeriodStart: at('2024-01-01'), proceeds: 3750, quantity: 15, realizedGain: 1750, transactionDate: at('2024-03-01'), transactionKey: 3 }),
      expect.objectContaining({ costBasis: 1000, holdingPeriodStart: at('2024-02-01'), proceeds: 900, quantity: 5, realizedGain: -100, transactionDate: at('2024-04-01'), transactionKey: 4 }),
    ]);
  });

  it('relieves the running average per sale under AVERAGE', () => {
    const result = disposals([
      buy(1, '2024-01-01', 10, 100),
      buy(2, '2024-02-01', 10, 200),
      sell(3, '2024-03-01', 5, 250),
      buy(4, '2024-03-15', 5, 300),
      sell(5, '2024-04-01', 10, 100),
    ], PortfolioCostBasisMethod.AVERAGE);

    // Pool 20 at 150; the first sale relieves 5 × 150. Then 15 at 150 + 5 at 300 = 20 at 187.5.
    expect(result).toEqual([
      expect.objectContaining({ costBasis: 750, holdingPeriodStart: at('2024-01-01'), proceeds: 1250, realizedGain: 500, transactionKey: 3 }),
      expect.objectContaining({ costBasis: 1875, holdingPeriodStart: at('2024-01-01'), proceeds: 1000, realizedGain: -875, transactionKey: 5 }),
    ]);
  });

  it('nets the sale fee out of proceeds and relieves the consumed lots’ fee share', () => {
    const result = disposals([
      buy(1, '2024-01-01', 10, 100, { fee_amount: 10 }),
      sell(2, '2024-02-01', 4, 150, { fee_amount: 2 }),
    ]);

    // 4 of 10 units carry 4 of the 10 fee; the sale's own fee comes off its 600 proceeds.
    expect(result).toEqual([expect.objectContaining({ costBasis: 404, proceeds: 598, realizedGain: 194 })]);
  });

  it('reads the cost of lots in the accounting currency and proceeds as recorded', () => {
    // Bought in USD, converted to the user's EUR at the time (90 per unit); sold for 1,100 EUR.
    const result = disposals([
      buy(1, '2024-01-01', 10, 100, { unit_appuser_amount: 90 }),
      sell(2, '2024-02-01', 10, 120, { proceeds_amount: 1100, unit_appuser_amount: 110 }),
    ]);

    expect(result).toEqual([expect.objectContaining({ costBasis: 900, proceeds: 1100, realizedGain: 200 })]);
  });

  it.each([PortfolioCostBasisMethod.FIFO, PortfolioCostBasisMethod.AVERAGE])('keeps the cost basis across a split under %s', (method) => {
    const result = disposals([
      buy(1, '2024-01-01', 10, 100),
      split('2024-01-15', 2, 1),
      sell(2, '2024-02-01', 20, 60),
    ], method);

    // 20 split-adjusted shares at 50 cost the same 1,000; the sale is recorded post-split.
    expect(result).toEqual([expect.objectContaining({ costBasis: 1000, holdingPeriodStart: at('2024-01-01'), proceeds: 1200, quantity: 20, realizedGain: 200 })]);
  });

  it('relieves no cost for the part of a sale that oversells the position', () => {
    const result = disposals([buy(1, '2024-01-01', 5, 100), sell(2, '2024-02-01', 10, 150)]);

    expect(result).toEqual([expect.objectContaining({ costBasis: 500, proceeds: 1500, quantity: 10 })]);
  });

  it('has no holding period for a sale with nothing to consume', () => {
    const result = disposals([sell(1, '2024-02-01', 10, 150)]);

    expect(result).toEqual([expect.objectContaining({ costBasis: 0, holdingPeriodStart: null })]);
  });

  it('flags a sale whose fee, or a consumed lot’s fee, could not be converted', () => {
    const result = disposals([
      buy(1, '2024-01-01', 10, 100, { fee_conversion_incomplete: true }),
      buy(2, '2024-02-01', 10, 100),
      sell(3, '2024-03-01', 10, 150),
      sell(4, '2024-04-01', 5, 150),
      sell(5, '2024-05-01', 5, 150, { fee_conversion_incomplete: true }),
    ]);

    expect(result.map((disposal) => disposal.feeConversionIncomplete)).toEqual([true, false, true]);
  });

  it('flags every AVERAGE sale out of a pool that holds an unconverted fee', () => {
    const result = disposals([
      buy(1, '2024-01-01', 10, 100, { fee_conversion_incomplete: true }),
      buy(2, '2024-02-01', 10, 100),
      sell(3, '2024-03-01', 20, 150),
      buy(4, '2024-04-01', 10, 100),
      sell(5, '2024-05-01', 10, 150),
    ], PortfolioCostBasisMethod.AVERAGE);

    // The pool emptied at the first sale, so the next one has a clean pool.
    expect(result.map((disposal) => disposal.feeConversionIncomplete)).toEqual([true, false]);
  });

  it('adds up to the realized cost basis per portfolio and asset', () => {
    const items: HoldingTimelineItem[] = [
      buy(1, '2024-01-01', 10, 100, { fee_amount: 3 }),
      buy(2, '2024-01-02', 7, 133.33),
      sell(3, '2024-02-01', 3.5, 150),
      split('2024-02-10', 3, 2),
      sell(4, '2024-03-01', 6, 120, { fee_amount: 1.5 }),
      buy(5, '2024-03-02', 4, 90, { portfolio_key: 2 }),
      sell(6, '2024-03-03', 1, 95, { portfolio_key: 2 }),
    ];

    for (const method of [PortfolioCostBasisMethod.FIFO, PortfolioCostBasisMethod.AVERAGE]) {
      const replay = replayHoldingTimeline(items, method);
      for (const [key, costBasis] of replay.realizedCostBasisByPortfolioAsset) {
        const perSale = replay.disposals
          .filter((disposal) => `${disposal.portfolioKey}:${disposal.financialAssetKey}` === key)
          .reduce((sum, disposal) => sum + disposal.costBasis, 0);
        expect(perSale).toBeCloseTo(costBasis, 8);
      }
    }
  });
});
