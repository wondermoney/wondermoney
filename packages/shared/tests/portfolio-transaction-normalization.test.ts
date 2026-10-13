import { describe, expect, it } from 'vitest';
import {
  derivePortfolioTransactionAmounts,
  normalizePortfolioTransactionQuantity,
  signPortfolioAmountForQuantity,
} from '../lib/entities/financial-transaction/portfolio-normalization';

describe('portfolio transaction normalization', () => {
  it.each([
    ['BUY', 2, 2],
    ['BUY', -2, 2],
    ['SELL', 2, -2],
    ['SELL', -2, -2],
    ['DIVIDEND', -2, -2],
    ['DEPOSIT', 1, 1],
    ['WITHDRAWAL', -1, -1],
    ['OFFER', 3, 3],
  ])('normalizes %s quantity %s -> %s', (typeName, quantity, expected) => {
    expect(normalizePortfolioTransactionQuantity(typeName as string, quantity)).toBe(expected);
  });

  it('derives amounts from normalized quantity sign', () => {
    expect(
      derivePortfolioTransactionAmounts({
        typeName: 'SELL',
        quantity: 2,
        unitPrice: 10,
        originalUnitPrice: 12,
      }),
    ).toEqual({ normalizedQuantity: -2, originalAmount: -24, settlementAmount: -20 });
  });

  it('signs broker totals consistently with quantity', () => {
    expect(signPortfolioAmountForQuantity(100, 2)).toBe(100);
    expect(signPortfolioAmountForQuantity(100, -2)).toBe(-100);
    expect(signPortfolioAmountForQuantity(100, 0)).toBe(0);
    expect(signPortfolioAmountForQuantity(undefined, 2)).toBeUndefined();
  });
});
