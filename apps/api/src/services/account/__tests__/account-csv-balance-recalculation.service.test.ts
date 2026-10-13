import { describe, expect, it } from 'vitest';

import service from '@service/account/account-csv-balance-recalculation.service';

type PlanAccount = Parameters<typeof service.planBankBalances>[0];
type PlanTransaction = PlanTransactions[number];
type PlanTransactions = Parameters<typeof service.planBankBalances>[1];

describe('account csv balance recalculation service', () => {
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

  // RAD-564: same-date rows are chained in `transactionKey` order — the same total order the
  // transactions list renders and `balance-chain.service.ts` accumulates over. It used to break
  // date ties on `settlementAmount`, so same-date rows were balanced in one order and displayed in
  // another. Rows not yet persisted have no key and keep their input order at the end of the date.
  it('sorts same-date rows by transaction key, not by settlement amount', () => {
    const account = { balance: 100, createdAt: new Date('2025-01-01') } as unknown as PlanAccount;
    const laterKey = { settlementAmount: 10, transactionDate: new Date('2025-01-01'), transactionKey: 2 } as unknown as PlanTransaction;
    const earlierKey = { settlementAmount: 20, transactionDate: new Date('2025-01-01'), transactionKey: 1 } as unknown as PlanTransaction;
    expect(service.planBankBalances(account, [], [laterKey, earlierKey])).toMatchObject({ items: [{ balance: 90, imported: true }, { balance: 100, imported: true }] });
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
