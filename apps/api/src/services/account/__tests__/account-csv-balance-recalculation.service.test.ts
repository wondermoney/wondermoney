import { describe, expect, it } from 'vitest';

import service from '@service/account/account-csv-balance-recalculation.service';

type PlanAccount = Parameters<typeof service.planBankBalances>[0];
type PlanTransaction = PlanTransactions[number];
type PlanTransactions = Parameters<typeof service.planBankBalances>[1];

describe('account csv balance recalculation service', () => {
  describe('a row with no converted amount (no exchange rate)', () => {
    const missing = (settlementAmount: number, day: number, transactionKey: number) => ({ appuserSettlementAmount: null, fxStatus: 'missing', settlementAmount, transactionDate: new Date(`2025-01-0${day}`), transactionKey }) as unknown as PlanTransaction;
    const converted = (settlementAmount: number, appuserSettlementAmount: number, day: number, transactionKey: number) => ({ appuserSettlementAmount, fxStatus: 'exact', settlementAmount, transactionDate: new Date(`2025-01-0${day}`), transactionKey }) as unknown as PlanTransaction;

    it('leaves the user-currency balance unknown rather than adding the foreign amount', () => {
      const account = { appuserCurrencyBalance: null, balance: 10_000, createdAt: new Date('2025-01-01'), fxStatus: 'missing' } as unknown as PlanAccount;

      const plan = service.planBankBalances(account, [], [missing(-500, 2, 1)]);

      expect(plan).toMatchObject({ accountAppuserBalance: null, accountBalance: 10_000, items: [{ appuserBalance: null, balance: 10_000 }] });
    });

    it('keeps the native running balance, and stops the user-currency one at the first missing row', () => {
      const account = { appuserCurrencyBalance: 90, balance: 100, createdAt: new Date('2025-01-01'), fxStatus: 'exact' } as unknown as PlanAccount;
      const existing = [converted(100, 90, 1, 1)];
      existing[0]!.balance = 100;
      existing[0]!.appuserCurrencyBalance = 90;

      const plan = service.planBankBalances(account, existing, [missing(-10, 3, 2), converted(-20, -18, 4, 3)]);

      expect(plan.accountBalance).toBe(70);
      expect(plan.accountAppuserBalance).toBeNull();
      expect(plan.items.map((item) => item.appuserBalance)).toEqual([null, null]);
    });
  });

  it('anchors empty accounts by current balance', () => {
    const account = { balance: 100, createdAt: new Date('2025-01-01') } as unknown as PlanAccount;
    const tx = { settlementAmount: 25, transactionDate: new Date('2025-01-02'), transactionKey: 1 } as unknown as PlanTransaction;
    expect(service.planBankBalances(account, [], [tx])).toMatchObject({ accountBalance: 100, items: [{ balance: 100, imported: true }] });
  });

  it('anchors empty accounts with multiple imports from ending balance', () => {
    const account = { balance: 100, createdAt: new Date('2025-01-01') } as unknown as PlanAccount;
    const first = { settlementAmount: 10, transactionDate: new Date('2025-01-01'), transactionKey: 1 } as unknown as PlanTransaction;
    const second = { settlementAmount: 20, transactionDate: new Date('2025-01-02'), transactionKey: 2 } as unknown as PlanTransaction;
    expect(service.planBankBalances(account, [], [first, second])).toMatchObject({ accountBalance: 100, items: [{ balance: 80, imported: true }, { balance: 100, imported: true }] });
  });

  // Same-date rows are chained in `transactionKey` order — the same total order the
  // transactions list renders and `balance-chain.service.ts` accumulates over, so same-date rows
  // are balanced in the order they are displayed. Rows not yet persisted have no key and keep their
  // input order at the end of the date.
  it('sorts same-date rows by transaction key, not by settlement amount', () => {
    const account = { balance: 100, createdAt: new Date('2025-01-01') } as unknown as PlanAccount;
    const laterKey = { settlementAmount: 10, transactionDate: new Date('2025-01-01'), transactionKey: 2 } as unknown as PlanTransaction;
    const earlierKey = { settlementAmount: 20, transactionDate: new Date('2025-01-01'), transactionKey: 1 } as unknown as PlanTransaction;
    expect(service.planBankBalances(account, [], [laterKey, earlierKey])).toMatchObject({ items: [{ balance: 90, imported: true }, { balance: 100, imported: true }] });
  });

  it('reports the balance before the oldest imported row as the opening balance', () => {
    const account = { balance: 100, createdAt: new Date('2025-01-01') } as unknown as PlanAccount;
    const first = { settlementAmount: 10, transactionDate: new Date('2025-01-01'), transactionKey: 1 } as unknown as PlanTransaction;
    const second = { settlementAmount: 20, transactionDate: new Date('2025-01-02'), transactionKey: 2 } as unknown as PlanTransaction;
    expect(service.planBankBalances(account, [], [second, first]).openingBalance).toBe(70);
  });

  it('moves the opening balance back when older rows are imported before existing ones', () => {
    const account = { balance: 150, createdAt: new Date('2025-01-01') } as unknown as PlanAccount;
    const existing = { balance: 150, settlementAmount: 50, transactionDate: new Date('2025-02-01'), transactionKey: 1 } as unknown as PlanTransaction;
    const older = { settlementAmount: 30, transactionDate: new Date('2025-01-15') } as unknown as PlanTransaction;
    expect(service.planBankBalances(account, [existing], [older]).openingBalance).toBe(70);
  });

  it('keeps the opening balance when only newer rows are imported', () => {
    const account = { balance: 150, createdAt: new Date('2025-01-01') } as unknown as PlanAccount;
    const existing = { balance: 150, settlementAmount: 50, transactionDate: new Date('2025-02-01'), transactionKey: 1 } as unknown as PlanTransaction;
    const newer = { settlementAmount: 30, transactionDate: new Date('2025-03-01') } as unknown as PlanTransaction;
    expect(service.planBankBalances(account, [existing], [newer]).openingBalance).toBe(100);
  });

  it('updates account balance for newer imports', () => {
    const account = { balance: 50, createdAt: new Date('2025-01-01') } as unknown as PlanAccount;
    const tx = { settlementAmount: 10, transactionDate: new Date('2025-01-02'), transactionKey: 1 } as unknown as PlanTransaction;
    expect(service.planBankBalances(account, [], [tx])).toMatchObject({ accountAppuserBalance: 50, accountBalance: 50, items: [{ balance: 50, imported: true }] });
  });

  it('keeps current account balance for older-only imports and backfills import balances', () => {
    const account = { balance: 130, createdAt: new Date('2025-01-01') } as unknown as PlanAccount;
    const existing = [{ balance: 160, settlementAmount: 30, transactionDate: new Date('2025-01-10'), transactionKey: 2 }] as unknown as PlanTransactions;
    const tx = { settlementAmount: 20, transactionDate: new Date('2025-01-01'), transactionKey: 1 } as unknown as PlanTransaction;
    expect(service.planBankBalances(account, existing, [tx])).toMatchObject({ accountBalance: 130, items: [{ balance: 130, imported: true }] });
  });

  it('recalculates mixed imports around existing transactions', () => {
    const account = { appuserCurrencyBalance: 220, balance: 200, createdAt: new Date('2025-01-01') } as unknown as PlanAccount;
    const existing = [
      { appuserCurrencyBalance: 140, appuserSettlementAmount: 14, balance: 100, settlementAmount: 20, transactionDate: new Date('2025-01-02'), transactionKey: 1 },
      { appuserCurrencyBalance: 190, appuserSettlementAmount: 50, balance: 150, settlementAmount: 50, transactionDate: new Date('2025-01-04'), transactionKey: 2 },
    ] as unknown as PlanTransactions;
    const older = { appuserSettlementAmount: 8, settlementAmount: 10, transactionDate: new Date('2025-01-01'), transactionKey: 3 } as unknown as PlanTransaction;
    const tx = { appuserSettlementAmount: 20, settlementAmount: 25, transactionDate: new Date('2025-01-03'), transactionKey: 4 } as unknown as PlanTransaction;
    expect(service.planBankBalances(account, existing, [older, tx])).toMatchObject({ accountAppuserBalance: 210, accountBalance: 175, items: [{ balance: 80, imported: true }, { balance: 100, imported: false }, { balance: 125, imported: true }, { balance: 175, imported: false }] });
  });
});
