import type { Big as BigType } from 'big.js';

import { FINANCIAL_TRANSACTION_TYPES } from '@app/constants/financial-transaction-types';
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

export interface HoldingBatch {
  fee_amount?: number;
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

export interface HoldingReplayResult {
  allBatches: HoldingBatch[];
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
 * Calculates weighted average buy price from remaining FIFO lots.
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

export function buildSplitAdjustedHoldingBatches(items: HoldingTimelineItem[]): HoldingBatch[] {
  return replayHoldingTimeline(items).openBatches;
}

export function replayHoldingTimeline(items: HoldingTimelineItem[]): HoldingReplayResult {
  const allBatches: HoldingBatch[] = [];
  const oversoldByPortfolioAsset = new Map<string, number>();
  const realizedCostBasisBigByPortfolioAsset = new Map<string, BigType>();
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
      continue;
    }

    const transaction = item;
    const normalizedQuantity = Number(transaction.quantity);
    const normalizedTransactionTypeKey = Number(transaction.financial_transaction_type_key);

    if (!Number.isFinite(normalizedQuantity) || normalizedQuantity === 0) continue;
    const absoluteQuantity = Math.abs(normalizedQuantity);
    const assetKey = `${transaction.portfolio_key}:${transaction.financial_asset_key}`;

    if (normalizedTransactionTypeKey === FINANCIAL_TRANSACTION_TYPES.BUY) {
      const normalizedUnitSettlementAmount = Number(transaction.unit_settlement_amount);
      const normalizedUnitAppuserAmount = transaction.unit_appuser_amount == null ? transaction.unit_appuser_amount : Number(transaction.unit_appuser_amount);
      if (!Number.isFinite(normalizedUnitSettlementAmount)) continue;
      if (normalizedUnitAppuserAmount != null && !Number.isFinite(normalizedUnitAppuserAmount)) continue;
      allBatches.push({
        ...toHoldingBatch(transaction, absoluteQuantity),
        financial_transaction_type_key: normalizedTransactionTypeKey,
        unit_appuser_amount: normalizedUnitAppuserAmount,
        unit_settlement_amount: normalizedUnitSettlementAmount,
      });
      continue;
    }

    if (normalizedTransactionTypeKey !== FINANCIAL_TRANSACTION_TYPES.SELL) continue;

    let sellRemaining = absoluteQuantity;
    for (const batch of allBatches) {
      if (sellRemaining <= 0) break;
      if (batch.portfolio_key !== transaction.portfolio_key || batch.financial_asset_key !== transaction.financial_asset_key) continue;
      const available = batch.remaining_batch ?? 0;
      if (available <= 0) continue;
      const consumed = Math.min(available, sellRemaining);
      const batchUnitAmount = batch.unit_appuser_amount ?? batch.unit_settlement_amount;
      batch.remaining_batch = available - consumed;
      const feeRemaining = batch.remaining_fee_amount ?? 0;
      const feeAllocated = consumed === available
        ? big(feeRemaining)
        : big(feeRemaining).times(big(consumed)).div(big(available));
      batch.remaining_fee_amount = Number(big(feeRemaining).minus(feeAllocated).toString());
      const realizedCostBasis = (realizedCostBasisBigByPortfolioAsset.get(assetKey) ?? big(0))
        .plus(big(consumed).times(big(batchUnitAmount)))
        .plus(feeAllocated);
      realizedCostBasisBigByPortfolioAsset.set(assetKey, realizedCostBasis);
      sellRemaining -= consumed;
    }
    if (sellRemaining > 1e-9) {
      oversoldByPortfolioAsset.set(assetKey, (oversoldByPortfolioAsset.get(assetKey) ?? 0) + sellRemaining);
    }
  }

  return {
    allBatches,
    openBatches: allBatches.filter((batch) => batch.remaining_batch != null && batch.remaining_batch > 0),
    oversoldByPortfolioAsset,
    realizedCostBasisByPortfolioAsset: new Map(
      [...realizedCostBasisBigByPortfolioAsset].map(([key, value]) => [key, Number(value.toString())]),
    ),
  };
}

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

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}
