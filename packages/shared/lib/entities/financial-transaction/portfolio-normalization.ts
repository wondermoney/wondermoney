export function normalizePortfolioTransactionQuantity(
  typeName: string | undefined,
  quantity: number,
) {
  if (typeName === 'BUY') return Math.abs(quantity);
  if (typeName === 'SELL') return -Math.abs(quantity);
  return quantity;
}

export function signPortfolioAmountForQuantity(
  amount: number | null | undefined,
  normalizedQuantity: number,
) {
  if (amount == null) return amount;
  if (normalizedQuantity < 0) return -Math.abs(amount);
  if (normalizedQuantity > 0) return Math.abs(amount);
  return 0;
}

export function derivePortfolioTransactionAmounts(input: {
  originalUnitPrice?: number | null;
  quantity: number;
  typeName?: string;
  unitPrice: number;
}) {
  const quantity = normalizePortfolioTransactionQuantity(
    input.typeName,
    input.quantity,
  );
  return {
    normalizedQuantity: quantity,
    originalAmount:
      input.originalUnitPrice == null ? undefined : input.originalUnitPrice * quantity,
    settlementAmount: input.unitPrice * quantity,
  };
}
