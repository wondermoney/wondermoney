import { describe, expect, it } from 'vitest';

import { demoAccounts } from '@app/database/seeders/demo/demo-fixtures';
import { demoPortfolioHoldings, demoPortfolios } from '@app/database/seeders/demo/demo-portfolio';
import {
  DEMO_BANK_TRANSACTION_ID_PREFIX,
  DEMO_PORTFOLIO_SNAPSHOT_ID_PREFIX,
  DEMO_PORTFOLIO_TRANSACTION_ID_PREFIX,
  demoBankTransactionFixtures,
  demoPortfolioTransactionFixtures,
} from '@service/demo-data/demo-data-fixtures';

describe('demo data fixtures', () => {
  it('shows a savings contribution as both sides of a transfer within the household', () => {
    const transfers = demoBankTransactionFixtures.filter((row) => row.merchant === 'Emergency Fund');
    expect(transfers).toHaveLength(2);
    expect(transfers.map((row) => row.accountName).sort()).toEqual([demoAccounts.current.accountName, demoAccounts.savings.accountName].sort());
    expect(transfers.reduce((total, row) => total + row.amount, 0)).toBe(0);
    expect(new Set(transfers.map((row) => row.offsetDays)).size).toBe(1);
    expect(transfers.map((row) => row.type).sort()).toEqual(['TRANSFER_IN', 'TRANSFER_OUT']);
  });
  it('exports bank transaction fixtures with stable ids and valid offsets', () => {
    expect(DEMO_BANK_TRANSACTION_ID_PREFIX).toBe('DEMO-BANK-TXN-');
    expect(demoBankTransactionFixtures.length).toBeGreaterThan(20);
    expect(new Set(demoBankTransactionFixtures.map((row) => row.externalTransactionId)).size).toBe(
      demoBankTransactionFixtures.length,
    );

    for (const row of demoBankTransactionFixtures) {
      expect(row.externalTransactionId).toMatch(/^DEMO-BANK-TXN-/);
      expect(Object.values(demoAccounts).map((account) => account.accountName)).toContain(row.accountName);
      expect(['DEPOSIT', 'PAYMENT', 'TRANSFER_IN', 'TRANSFER_OUT']).toContain(row.type);
      expect(row.offsetDays).toBeGreaterThanOrEqual(0);
      expect(row.offsetDays).toBeLessThanOrEqual(45);
    }
  });

  it('exports portfolio transaction fixtures with stable ids and supported references', () => {
    expect(DEMO_PORTFOLIO_TRANSACTION_ID_PREFIX).toBe('DEMO-PORTFOLIO-TXN-');
    expect(DEMO_PORTFOLIO_SNAPSHOT_ID_PREFIX).toBe('DEMO-PORTFOLIO-SNAPSHOT-');
    expect(demoPortfolioTransactionFixtures.length).toBeGreaterThan(5);
    expect(new Set(demoPortfolioTransactionFixtures.map((row) => row.externalTransactionId)).size).toBe(
      demoPortfolioTransactionFixtures.length,
    );

    for (const row of demoPortfolioTransactionFixtures) {
      expect(row.externalTransactionId).toMatch(/^DEMO-PORTFOLIO-TXN-/);
      expect(demoPortfolios.map((portfolio) => portfolio.name)).toContain(row.portfolioName);
      expect([...new Set(demoPortfolioHoldings.map((holding) => holding.symbol)), 'CURRENCY_USD']).toContain(
        row.symbol,
      );
      expect(['BUY', 'DEPOSIT', 'DIVIDEND', 'SELL', 'WITHDRAWAL']).toContain(row.type);
      expect(row.offsetDays).toBeGreaterThanOrEqual(0);
      expect(row.offsetDays).toBeLessThanOrEqual(45);
    }
  });
});
