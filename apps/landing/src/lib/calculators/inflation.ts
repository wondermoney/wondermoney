import { CPI_YEARS, PORTUGAL_CPI } from "./portugalCpi";

export const INFLATION_MAX_AMOUNT = 1_000_000_000;
export const INFLATION_EXAMPLE = { from: 2020, to: 2025, amount: 1000, finalValue: 1100 };

type InflationInput = {
  from: number;
  to: number;
  amount: number;
  finalValue: number | null;
};

export function validInflationAmount(amount: number): boolean {
  return Number.isFinite(amount) && amount >= 0 && amount <= INFLATION_MAX_AMOUNT;
}

export function computeInflation({ from, to, amount, finalValue }: InflationInput) {
  if (!CPI_YEARS.includes(from) || !CPI_YEARS.includes(to) || !validInflationAmount(amount)) {
    return null;
  }
  if (finalValue !== null && !validInflationAmount(finalValue)) return null;

  const priceRatio = PORTUGAL_CPI[to] / PORTUGAL_CPI[from];
  const realValue = finalValue === null ? null : finalValue / priceRatio;

  return {
    priceChange: (priceRatio - 1) * 100,
    equivalent: amount * priceRatio,
    budgetChange: amount * (priceRatio - 1),
    realValue,
    realChange: realValue === null ? null : realValue - amount,
  };
}
