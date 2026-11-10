import { sumMoney } from '@utils/money';

import type { PortfolioHolding } from './portfolio-holdings.utils';

export interface PortfolioValue {
  /** False when a valid holding has no current value (no price or no exchange rate), so `value` leaves it out. */
  isComplete: boolean;
  /** Current market value in the user's currency. */
  value: number;
}

/**
 * The one definition of a portfolio's current value: the sum of its valid holdings' current
 * values (latest price, converted to the user's currency). The portfolio list, the dashboards
 * and net worth all value a portfolio through this, so they show the same figure. The daily
 * snapshot is history, not the current value: it misses anything traded since it was taken.
 * Invalid holdings (more units sold than bought) are left out, as the dashboards leave them out.
 */
export function valuePortfolioHoldings(holdings: Pick<PortfolioHolding, 'currentValue' | 'isInvalid'>[]): PortfolioValue {
  const validHoldings = holdings.filter((holding) => !holding.isInvalid);
  const pricedValues = validHoldings
    .map((holding) => holding.currentValue)
    .filter((value): value is number => value != null);
  return { isComplete: pricedValues.length === validHoldings.length, value: sumMoney(pricedValues) };
}
