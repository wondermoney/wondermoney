import type { Big as BigType } from 'big.js';

import { FINANCIAL_TRANSACTION_TYPES } from '@app/constants/financial-transaction-types';
import { PortfolioCostBasisMethod } from '@app/constants/portfolio-cost-basis';
import { big } from '@utils/money';

export interface CertificadoAforroHoldingDetail {
  currentRateBps: number;
  lots: CertificadoAforroLotDetail[];
  nextCapitalizationDate: string;
  premiumTierBps: number;
}

export interface CertificadoAforroLotDetail {
  accruedValue: number;
  principal: number;
  subscriptionDate: string;
  taxExempt: boolean;
  transactionKey: number;
  yearsHeld: number;
}

/**
 * A portfolio's cost basis method, or a lookup for a replay that spans portfolios (the
 * aggregate holdings read). A single method is used for every portfolio in the first case.
 */
export type CostBasisMethodResolver =
  | ((portfolioKey: number) => PortfolioCostBasisMethod)
  | PortfolioCostBasisMethod;

export interface HoldingBatch {
  fee_amount?: number;
  /** The lot's fee could not be converted to the accounting currency and counts as zero. */
  fee_conversion_incomplete?: boolean;
  financial_asset_currency_code?: string;
  financial_asset_esg_score?: number | string;
  financial_asset_key: number;
  financial_asset_logo_url?: string;
  financial_asset_name: string;
  financial_asset_symbol: string;
  financial_asset_type_name: string;
  financial_transaction_type_key: number;
  portfolio_key: number;
  quantity: number;
  remaining_batch: null | number;
  remaining_fee_amount?: number;
  transaction_date: Date;
  transaction_key: number;
  unit_appuser_amount?: null | number;
  unit_settlement_amount: number;
}

/**
 * One sale, as the replay relieved it. Amounts are in the accounting currency of the rows: the
 * recording member's currency when the trade stores converted amounts, else its settlement
 * currency (the same basis as the portfolio's realized total).
 */
export interface HoldingDisposal {
  /** The cost the sale relieved under the portfolio's method, the lots' fee share included. */
  costBasis: number;
  /** The sale's fee, or the fee of a lot (or AVERAGE pool) it relieved, was counted as zero. */
  feeConversionIncomplete: boolean;
  financialAssetKey: number;
  /** The purchase date of the oldest lot the sale consumed; null when it consumed none. */
  holdingPeriodStart: Date | null;
  portfolioKey: number;
  /** The sale's proceeds less its fee. */
  proceeds: number;
  /** The quantity sold, as recorded (split-adjusted as of the sale). */
  quantity: number;
  realizedGain: number;
  transactionDate: Date;
  transactionKey: number;
}

export interface HoldingReplayResult {
  allBatches: HoldingBatch[];
  /** One per sale, in replay order (by date, then time, then transaction key). */
  disposals: HoldingDisposal[];
  openBatches: HoldingBatch[];
  oversoldByPortfolioAsset: Map<string, number>;
  realizedCostBasisByPortfolioAsset: Map<string, number>;
}

export type HoldingTimelineItem = HoldingTransactionTimelineItem | StockSplitTimelineItem;

export interface HoldingTransactionTimelineItem
  extends Omit<
    HoldingBatch,
    'fee_amount' | 'financial_transaction_type_key' | 'quantity' | 'remaining_batch' | 'unit_appuser_amount' | 'unit_settlement_amount'
  > {
  fee_amount?: null | NumericInput;
  financial_transaction_type_key: NumericInput;
  itemType: 'TRANSACTION';
  /**
   * A sale's gross proceeds in the accounting currency, as recorded. When absent, quantity times
   * the unit amount.
   */
  proceeds_amount?: null | NumericInput;
  quantity: NumericInput;
  unit_appuser_amount?: null | NumericInput;
  unit_settlement_amount: NumericInput;
}

export interface PortfolioAsset {
  averageBuyPrice: number;
  financialAssetCurrencyCode?: string;
  financialAssetEsgScore?: number | string;
  financialAssetKey: number;
  financialAssetLogoUrl?: string;
  financialAssetName: string;
  financialAssetSymbol: string;
  financialAssetType: string;
  portfolioKey?: number;
  portfolioName?: string;
  quantity: number;
}

export interface PortfolioHolding extends PortfolioAsset {
  allocation: null | number;
  /** Populated only for Savings Certificate holdings — per-lot accrual detail for the web accrual panel. */
  certificadoAforroDetail?: CertificadoAforroHoldingDetail;
  currency: string;
  currentPrice: null | number;
  currentValue: null | number;
  /** Set only when a fee of this asset had no usable exchange rate and was counted as zero. */
  feeConversionIncomplete?: boolean;
  invalidReason?: 'NEGATIVE_UNITS';
  isInvalid?: boolean;
  /**
   * Lifetime realized gain of this asset in scope (its sales' proceeds less the cost they
   * relieved), in the same amounts as `unrealizedGains`. Null for an oversold holding. Set by
   * the holdings reads.
   */
  realizedGains?: null | number;
  relatedTransactionKeys?: number[];
  unrealizedGains: null | number;
  unrealizedGainsPercentage: null | number;
}

export interface StockSplitTimelineItem {
  date: Date;
  denominator: NumericInput;
  financial_asset_key: number;
  itemType: 'SPLIT';
  numerator: NumericInput;
  split_ratio?: NumericInput;
}

interface AveragePool {
  assetKey: number;
  /** All-in remaining cost, fees included. */
  cost: BigType;
  /** The fee share still attached to the open position. */
  fees: BigType;
  /** A fee in the pool was counted as zero; cleared when the position closes. */
  feeConversionIncomplete: boolean;
  quantity: BigType;
}

type NumericInput = number | string;

export function filterValidHoldings(holdings: PortfolioHolding[]): PortfolioHolding[] {
  return holdings.filter((holding) => !holding.isInvalid);
}

export function getPortfolioAssetInvalidKey(portfolioKey: number, financialAssetKey: number): string {
  return `${portfolioKey}:${financialAssetKey}`;
}

/**
 * Recomputes `allocation` across a combined set of holdings (e.g. price-enriched assets plus
 * separately-valued Savings Certificate holdings — see `certificado-aforro-holdings.service.ts`).
 * Must run on the full combined array: computing allocation on a subset understates the total
 * and overstates every other holding's share.
 */
export function recomputeAllocation(holdings: PortfolioHolding[]): PortfolioHolding[] {
  const total = holdings.reduce((acc, holding) => acc + (holding.currentValue ?? 0), 0);
  return holdings.map((holding) => ({
    ...holding,
    allocation: holding.currentValue && total > 0 ? (holding.currentValue / total) * 100 : null,
  }));
}

function toHoldingBatch(transaction: HoldingTransactionTimelineItem, quantity: number): HoldingBatch {
  return {
    fee_amount: transaction.fee_amount == null ? 0 : Math.abs(Number(transaction.fee_amount)),
    ...(transaction.fee_conversion_incomplete ? { fee_conversion_incomplete: true } : {}),
    financial_asset_currency_code: transaction.financial_asset_currency_code,
    financial_asset_esg_score: transaction.financial_asset_esg_score,
    financial_asset_key: transaction.financial_asset_key,
    financial_asset_logo_url: transaction.financial_asset_logo_url,
    financial_asset_name: transaction.financial_asset_name,
    financial_asset_symbol: transaction.financial_asset_symbol,
    financial_asset_type_name: transaction.financial_asset_type_name,
    financial_transaction_type_key: Number(transaction.financial_transaction_type_key),
    portfolio_key: transaction.portfolio_key,
    quantity,
    remaining_batch: quantity,
    remaining_fee_amount: transaction.fee_amount == null ? 0 : Math.abs(Number(transaction.fee_amount)),
    transaction_date: transaction.transaction_date,
    transaction_key: transaction.transaction_key,
    unit_appuser_amount: transaction.unit_appuser_amount == null ? transaction.unit_appuser_amount : Number(transaction.unit_appuser_amount),
    unit_settlement_amount: Number(transaction.unit_settlement_amount),
  };
}

/**
 * Aggregate transaction batches into portfolio assets.
 * Combines remaining quantities from multiple lots into a single holding per asset.
 * Calculates the weighted average buy price of the remaining lots (under AVERAGE those lots
 * already carry the pooled unit cost).
 */
export function aggregateBatchesIntoAssets(batches: HoldingBatch[]): PortfolioAsset[] {
  const totalBasisByAsset = new Map<number, BigType>();
  return batches
    .filter((t) => t.remaining_batch != null && t.remaining_batch > 0) // Only lots with remaining quantity
    .reduce<PortfolioAsset[]>((acc, cur) => {
      const existingAssetKey = acc.find((x) => x.financialAssetKey === cur.financial_asset_key);
      const unitAmount = cur.unit_appuser_amount ?? cur.unit_settlement_amount;
      const remainingBatch = cur.remaining_batch ?? 0;
      const totalBasis = big(unitAmount).times(big(remainingBatch)).plus(big(cur.remaining_fee_amount ?? 0));
      if (existingAssetKey) {
        const newQuantity = existingAssetKey.quantity + remainingBatch;
        const combinedBasis = (totalBasisByAsset.get(cur.financial_asset_key) ?? big(0)).plus(totalBasis);
        totalBasisByAsset.set(cur.financial_asset_key, combinedBasis);
        existingAssetKey.averageBuyPrice = Number(combinedBasis.div(big(newQuantity)).toString());
        existingAssetKey.quantity = newQuantity;
      } else {
        totalBasisByAsset.set(cur.financial_asset_key, totalBasis);
        acc.push({
          averageBuyPrice: Number(totalBasis.div(big(remainingBatch || 1)).toString()),
          financialAssetCurrencyCode: cur.financial_asset_currency_code,
          financialAssetEsgScore: cur.financial_asset_esg_score,
          financialAssetKey: cur.financial_asset_key,
          financialAssetLogoUrl: cur.financial_asset_logo_url,
          financialAssetName: cur.financial_asset_name,
          financialAssetSymbol: cur.financial_asset_symbol,
          financialAssetType: cur.financial_asset_type_name,
          quantity: cur.remaining_batch || 0,
        });
      }
      return acc;
    }, []);
}

export function buildSplitAdjustedHoldingBatches(
  items: HoldingTimelineItem[],
  method: CostBasisMethodResolver = PortfolioCostBasisMethod.FIFO,
): HoldingBatch[] {
  return replayHoldingTimeline(items, method).openBatches;
}

/**
 * Replays buys, sells and splits per portfolio and asset into open lots and realized cost basis.
 *
 * `FIFO` consumes the oldest lots first: a sale relieves each lot's own unit cost plus its share
 * of that lot's fee. `AVERAGE` relieves cost at the running average of the open position, and the
 * sale leaves that average unchanged; fees paid on a buy join the pool and are relieved with it.
 * Splits scale quantity and unit cost inversely in both methods, so the cost basis is unchanged.
 *
 * Under `AVERAGE` the returned open lots still carry one row per purchase (their quantities are
 * consumed oldest-first, as in FIFO) but their unit costs are rewritten to the pooled average, so
 * `aggregateBatchesIntoAssets` reports the pooled `averageBuyPrice`. Closed lots keep the cost
 * they were bought at.
 */
export function replayHoldingTimeline(
  items: HoldingTimelineItem[],
  method: CostBasisMethodResolver = PortfolioCostBasisMethod.FIFO,
): HoldingReplayResult {
  const methodFor = typeof method === 'function' ? method : () => method;
  const allBatches: HoldingBatch[] = [];
  const disposals: HoldingDisposal[] = [];
  const oversoldByPortfolioAsset = new Map<string, number>();
  const realizedCostBasisBigByPortfolioAsset = new Map<string, BigType>();
  // Running pooled position per `portfolio:asset`, only for AVERAGE portfolios.
  const averagePools = new Map<string, AveragePool>();
  const sorted = [...items].sort((a, b) => {
    const dateKeyA = toDateKey('date' in a ? a.date : a.transaction_date);
    const dateKeyB = toDateKey('date' in b ? b.date : b.transaction_date);
    if (dateKeyA !== dateKeyB) return dateKeyA.localeCompare(dateKeyB);
    if (a.itemType !== b.itemType) return a.itemType === 'SPLIT' ? -1 : 1;
    if (a.itemType === 'TRANSACTION' && b.itemType === 'TRANSACTION') {
      const timeDiff = a.transaction_date.getTime() - b.transaction_date.getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.transaction_key - b.transaction_key;
    }
    if (a.itemType === 'SPLIT' && b.itemType === 'SPLIT') {
      return a.date.getTime() - b.date.getTime();
    }
    return 0;
  });

  for (const item of sorted) {
    if (item.itemType === 'SPLIT') {
      const { denominator, numerator } = normalizeSplitRatio(item);
      if (!isFinitePositiveRatio(numerator, denominator)) continue;
      const ratio = Number(numerator) / Number(denominator);
      for (const batch of allBatches) {
        if (batch.financial_asset_key !== item.financial_asset_key || batch.remaining_batch == null || batch.remaining_batch <= 0) continue;
        batch.quantity *= ratio;
        batch.remaining_batch *= ratio;
        batch.unit_settlement_amount /= ratio;
        if (batch.unit_appuser_amount != null) batch.unit_appuser_amount /= ratio;
      }
      // A split scales the pooled position's quantity, never its cost: the average per unit
      // falls by the same ratio.
      for (const pool of averagePools.values()) {
        if (pool.assetKey === item.financial_asset_key) pool.quantity = pool.quantity.times(big(ratio));
      }
      continue;
    }

    const transaction = item;
    const normalizedQuantity = Number(transaction.quantity);
    const normalizedTransactionTypeKey = Number(transaction.financial_transaction_type_key);

    if (!Number.isFinite(normalizedQuantity)) continue;
    // A zero-quantity sale still has proceeds the realized total counts, so it is a disposal.
    if (normalizedQuantity === 0 && normalizedTransactionTypeKey !== FINANCIAL_TRANSACTION_TYPES.SELL) continue;
    const absoluteQuantity = Math.abs(normalizedQuantity);
    const assetKey = `${transaction.portfolio_key}:${transaction.financial_asset_key}`;
    const isAverage = methodFor(transaction.portfolio_key) === PortfolioCostBasisMethod.AVERAGE;

    if (normalizedTransactionTypeKey === FINANCIAL_TRANSACTION_TYPES.BUY) {
      const normalizedUnitSettlementAmount = Number(transaction.unit_settlement_amount);
      const normalizedUnitAppuserAmount = transaction.unit_appuser_amount == null ? transaction.unit_appuser_amount : Number(transaction.unit_appuser_amount);
      if (!Number.isFinite(normalizedUnitSettlementAmount)) continue;
      if (normalizedUnitAppuserAmount != null && !Number.isFinite(normalizedUnitAppuserAmount)) continue;
      const batch = {
        ...toHoldingBatch(transaction, absoluteQuantity),
        financial_transaction_type_key: normalizedTransactionTypeKey,
        unit_appuser_amount: normalizedUnitAppuserAmount,
        unit_settlement_amount: normalizedUnitSettlementAmount,
      };
      allBatches.push(batch);
      if (isAverage) {
        const unitAmount = normalizedUnitAppuserAmount ?? normalizedUnitSettlementAmount;
        const fee = big(batch.fee_amount ?? 0);
        const pool = averagePools.get(assetKey) ?? { assetKey: transaction.financial_asset_key, cost: big(0), feeConversionIncomplete: false, fees: big(0), quantity: big(0) };
        pool.quantity = pool.quantity.plus(big(absoluteQuantity));
        if (transaction.fee_conversion_incomplete) pool.feeConversionIncomplete = true;
        pool.cost = pool.cost.plus(big(absoluteQuantity).times(big(unitAmount))).plus(fee);
        pool.fees = pool.fees.plus(fee);
        averagePools.set(assetKey, pool);
      }
      continue;
    }

    if (normalizedTransactionTypeKey !== FINANCIAL_TRANSACTION_TYPES.SELL) continue;

    let sellRemaining = absoluteQuantity;
    let saleCostBasis = big(0);
    let holdingPeriodStart: Date | null = null;
    let feeConversionIncomplete = transaction.fee_conversion_incomplete === true;
    for (const batch of allBatches) {
      if (sellRemaining <= 0) break;
      if (batch.portfolio_key !== transaction.portfolio_key || batch.financial_asset_key !== transaction.financial_asset_key) continue;
      const available = batch.remaining_batch ?? 0;
      if (available <= 0) continue;
      const consumed = Math.min(available, sellRemaining);
      holdingPeriodStart ??= batch.transaction_date;
      if (!isAverage && batch.fee_conversion_incomplete) feeConversionIncomplete = true;
      const batchUnitAmount = batch.unit_appuser_amount ?? batch.unit_settlement_amount;
      batch.remaining_batch = available - consumed;
      const feeRemaining = batch.remaining_fee_amount ?? 0;
      const feeAllocated = consumed === available
        ? big(feeRemaining)
        : big(feeRemaining).times(big(consumed)).div(big(available));
      batch.remaining_fee_amount = Number(big(feeRemaining).minus(feeAllocated).toString());
      if (!isAverage) {
        const relieved = big(consumed).times(big(batchUnitAmount)).plus(feeAllocated);
        saleCostBasis = saleCostBasis.plus(relieved);
        const realizedCostBasis = (realizedCostBasisBigByPortfolioAsset.get(assetKey) ?? big(0)).plus(relieved);
        realizedCostBasisBigByPortfolioAsset.set(assetKey, realizedCostBasis);
      }
      sellRemaining -= consumed;
    }
    if (sellRemaining > 1e-9) {
      oversoldByPortfolioAsset.set(assetKey, (oversoldByPortfolioAsset.get(assetKey) ?? 0) + sellRemaining);
    }
    if (isAverage) {
      const pool = averagePools.get(assetKey);
      if (pool?.quantity.gt(0)) {
        // The quantity actually relieved from the lots above; an oversell relieves no cost.
        const soldQuantity = big(absoluteQuantity - sellRemaining);
        const relievedQuantity = soldQuantity.gt(pool.quantity) ? pool.quantity : soldQuantity;
        const averageCost = pool.cost.div(pool.quantity);
        const feeShare = pool.fees.times(relievedQuantity).div(pool.quantity);
        saleCostBasis = relievedQuantity.times(averageCost);
        if (pool.feeConversionIncomplete) feeConversionIncomplete = true;
        const realizedCostBasis = (realizedCostBasisBigByPortfolioAsset.get(assetKey) ?? big(0))
          .plus(saleCostBasis);
        realizedCostBasisBigByPortfolioAsset.set(assetKey, realizedCostBasis);
        pool.cost = pool.cost.minus(saleCostBasis);
        pool.fees = pool.fees.minus(feeShare);
        pool.quantity = pool.quantity.minus(relievedQuantity);
        if (!pool.quantity.gt(0)) pool.feeConversionIncomplete = false;
      }
    }

    const proceeds = saleProceedsNetOfFee(transaction, absoluteQuantity);
    disposals.push({
      costBasis: Number(saleCostBasis.toString()),
      feeConversionIncomplete,
      financialAssetKey: transaction.financial_asset_key,
      holdingPeriodStart,
      portfolioKey: transaction.portfolio_key,
      proceeds: Number(proceeds.toString()),
      quantity: absoluteQuantity,
      realizedGain: Number(proceeds.minus(saleCostBasis).toString()),
      transactionDate: transaction.transaction_date,
      transactionKey: transaction.transaction_key,
    });
  }

  if (averagePools.size > 0) applyAveragePoolToOpenBatches(allBatches, averagePools);

  return {
    allBatches,
    disposals,
    openBatches: allBatches.filter((batch) => batch.remaining_batch != null && batch.remaining_batch > 0),
    oversoldByPortfolioAsset,
    realizedCostBasisByPortfolioAsset: new Map(
      [...realizedCostBasisBigByPortfolioAsset].map(([key, value]) => [key, Number(value.toString())]),
    ),
  };
}

/**
 * Rewrites the open lots of an AVERAGE portfolio so their aggregate is the pooled position:
 * every open lot carries the pooled ex-fee unit cost, and the pool's remaining fee is spread
 * across them by remaining quantity. `aggregateBatchesIntoAssets` then reports the pooled
 * `averageBuyPrice` and the same total cost basis the pool holds.
 */
function applyAveragePoolToOpenBatches(allBatches: HoldingBatch[], averagePools: Map<string, AveragePool>): void {
  for (const [key, pool] of averagePools) {
    if (!pool.quantity.gt(0)) continue;
    const openBatches = allBatches.filter(
      (batch) => `${batch.portfolio_key}:${batch.financial_asset_key}` === key && batch.remaining_batch != null && batch.remaining_batch > 0,
    );
    const totalRemaining = openBatches.reduce((sum, batch) => sum.plus(big(batch.remaining_batch ?? 0)), big(0));
    if (!totalRemaining.gt(0)) continue;
    const unitCost = pool.cost.minus(pool.fees).div(pool.quantity);
    for (const batch of openBatches) {
      const share = big(batch.remaining_batch ?? 0).div(totalRemaining);
      if (batch.unit_appuser_amount != null) batch.unit_appuser_amount = Number(unitCost.toString());
      else batch.unit_settlement_amount = Number(unitCost.toString());
      batch.remaining_fee_amount = Number(pool.fees.times(share).toString());
    }
  }
}

/**
 * A sale's proceeds less its fee, as the realized total counts them: the recorded proceeds when
 * the timeline carries them, else quantity times the unit amount.
 */
function isFinitePositiveRatio(numerator: NumericInput, denominator: NumericInput): boolean {
  const normalizedNumerator = Number(numerator);
  const normalizedDenominator = Number(denominator);
  const ratio = normalizedNumerator / normalizedDenominator;
  return (
    Number.isFinite(normalizedNumerator) &&
    Number.isFinite(normalizedDenominator) &&
    normalizedNumerator > 0 &&
    normalizedDenominator > 0 &&
    Number.isFinite(ratio) &&
    ratio > 0
  );
}

function normalizeSplitRatio(item: StockSplitTimelineItem): { denominator: NumericInput; numerator: NumericInput } {
  if (Number.isFinite(Number(item.numerator)) && Number.isFinite(Number(item.denominator))) {
    return { denominator: item.denominator, numerator: item.numerator };
  }
  const splitRatio = Number(item.split_ratio);
  if (Number.isFinite(splitRatio) && splitRatio > 0) {
    return { denominator: 1, numerator: splitRatio };
  }
  return item;
}

function saleProceedsNetOfFee(transaction: HoldingTransactionTimelineItem, absoluteQuantity: number): BigType {
  const fee = transaction.fee_amount == null ? 0 : Math.abs(Number(transaction.fee_amount));
  const gross = transaction.proceeds_amount == null
    ? big(absoluteQuantity).times(big(Number(transaction.unit_appuser_amount ?? transaction.unit_settlement_amount)))
    : big(Math.abs(Number(transaction.proceeds_amount)));
  return gross.minus(big(fee));
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}
