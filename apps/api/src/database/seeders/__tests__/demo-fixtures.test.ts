import { describe, expect, it } from 'vitest';

import { demoAccounts, demoPersona } from '../demo/demo-fixtures';
import { demoBudget } from '../demo/demo-budget';
import { demoLoans } from '../demo/demo-loans';
import { demoPortfolios, demoPortfolioHoldings } from '../demo/demo-portfolio';
import { demoTransactionPatterns } from '../demo/demo-transactions';

describe('demo fixtures', () => {
  it('exports the demo persona and account names', () => {
    expect(demoPersona).toMatchObject({
      email: 'demo@wonder.money',
      firstName: 'Sofia',
      householdName: 'Sofia Martins household',
      primaryCurrency: 'EUR',
    });
    expect(demoAccounts.current.accountName).toBe('ActivoBank Current Account');
    expect(demoAccounts.savings.accountName).toBe('Emergency Fund');
    expect(demoAccounts.usd.accountName).toBe('Revolut USD Account');
  });

  it('exports the demo budget, portfolios, loans, and transactions', () => {
    expect(demoBudget).toMatchObject({
      description: 'Curated household budget for Sofia Martins and family.',
      name: 'Household budget',
      requiredCategories: expect.arrayContaining(['GROCERIES', 'RENT_MORTGAGE']),
    });
    expect(demoPortfolios).toHaveLength(3);
    expect(demoPortfolios[0]).toMatchObject({ name: 'Long-term investments', currency: 'EUR' });
    expect(demoPortfolioHoldings.every((holding) => holding.portfolioName === 'Long-term investments')).toBe(true);
    expect(demoPortfolioHoldings.map((holding) => holding.symbol)).toEqual([
      'CURRENCY_EUR',
      'AAPL',
      'GOOGL',
      'INTC',
      'NVDA',
      'CRM',
      'TXN',
    ]);
    expect(demoLoans.mortgage.name).toBe('Home mortgage');
    expect(demoLoans.carLoan.name).toBe('Family car loan');
    expect(demoTransactionPatterns.some((pattern) => pattern.merchant === 'Continente')).toBe(true);
  });
});
