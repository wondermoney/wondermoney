import { describe, expect, it } from 'vitest';

import { addTransaction, ONE_OF_EACH_STATUS, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Transaction } from '@entity/Transaction';

import { excludeExpired, isExpiredStatusName, notExpiredTransactionSql } from '../transaction-status';

describe('the EXPIRED transaction rule', () => {
  const db = useTestDatabase();

  async function seed() {
    const em = db.em();
    const household = await seedHousehold(em);
    const byStatus = new Map<null | string, number>();
    for (const status of ONE_OF_EACH_STATUS) {
      byStatus.set(status, (await addTransaction(em, household, { amount: -10, date: new Date('2026-07-10T00:00:00Z'), status })).transactionKey);
    }
    return byStatus;
  }

  it('keeps booked, pending and status-less rows through the ORM condition, composed with an existing $or and $and', async () => {
    const byStatus = await seed();

    const rows = await db.em().find(Transaction, excludeExpired({ $and: [{ deletedAt: undefined }], $or: [{ settlementAmount: { $lt: 0 } }, { settlementAmount: null }] }));

    expect(rows.map((row) => row.transactionKey).sort()).toEqual([byStatus.get('BOOKED'), byStatus.get('PENDING'), byStatus.get(null)].sort());
  });

  it('keeps the same rows through the raw SQL predicate', async () => {
    const byStatus = await seed();

    const rows = await db.em().getConnection().execute<{ transaction_key: number }[]>(`select t.transaction_key from "transaction" t where ${notExpiredTransactionSql('t')}`);

    expect(rows.map((row) => row.transaction_key).sort()).toEqual([byStatus.get('BOOKED'), byStatus.get('PENDING'), byStatus.get(null)].sort());
  });

  it('names only EXPIRED as money that never moved', () => {
    expect([null, undefined, 'BOOKED', 'PENDING', 'EXPIRED'].map(isExpiredStatusName)).toEqual([false, false, false, false, true]);
  });
});
