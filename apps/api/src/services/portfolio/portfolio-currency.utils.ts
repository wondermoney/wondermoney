import { convertMoney, roundDisplay } from '@utils/money';
interface HoldingCurrentMetricsInput {
  assetType: string;
  averageBuyPrice: number;
  /** 1 in the asset's own currency; null or undefined when no rate exists, leaving the holding unvalued. */
  conversionRate?: null | number;
  quantity: number;
  rawCurrentPrice: null | number;
}

interface HoldingUnitAmountLike {
  unit_appuser_amount?: null | number;
  unit_settlement_amount: number;
}

interface SnapshotLike {
  appuserCurrencyTotalValue?: null | number;
  totalValue?: null | number;
}

export function getPreferredSnapshotTotalValue(snapshot: SnapshotLike): number {
  return snapshot.appuserCurrencyTotalValue ?? snapshot.totalValue ?? 0;
}

export function resolveHoldingCurrentMetrics({
  assetType,
  averageBuyPrice,
  conversionRate,
  quantity,
  rawCurrentPrice,
}: HoldingCurrentMetricsInput) {
  const effectiveRawPrice = assetType.toLowerCase() === 'cash' ? 1 : rawCurrentPrice;
  // No rate means no price in the target currency: never an implied rate of 1.
  const currentPrice = effectiveRawPrice != null && conversionRate != null
    ? roundCurrency(convertMoney(effectiveRawPrice, conversionRate))
    : null;
  const currentValue = currentPrice != null ? roundCurrency(currentPrice * quantity) : null;
  const initialInvestment = averageBuyPrice * quantity;
  const unrealizedGains = currentValue != null ? roundCurrency(currentValue - initialInvestment) : null;
  const unrealizedGainsPercentage =
    unrealizedGains != null && initialInvestment !== 0 ? (unrealizedGains / initialInvestment) * 100 : null;

  return {
    currentPrice,
    currentValue,
    unrealizedGains,
    unrealizedGainsPercentage,
  };
}

export function resolveHoldingUnitAmount(holding: HoldingUnitAmountLike): number {
  return holding.unit_appuser_amount ?? holding.unit_settlement_amount;
}

export function roundCurrency(value: number): number {
  // Not `Math.round(value * 100) / 100`, which rounds toward +Infinity for negatives: expenses
  // are stored negative, so income and expenses would round in opposite directions. Delegates
  // to the shared half-even helper.
  return roundDisplay(value);
}
