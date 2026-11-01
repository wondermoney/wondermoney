import { describe, expect, it, vi } from 'vitest';

import { addTransaction, ONE_OF_EACH_STATUS, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

import { listTransactions } from '../transaction-list.service';

/*
 * The transactions table carries no status, so an EXPIRED row (a dropped pending, or a payment the
 * bank rejected or cancelled) would read as money that moved and land in the review inbox. It is
 * left out of the list and of its total; pending and status-less rows stay.
 */
describe('transaction list and transaction status', () => {
  const db = useTestDatabase();

  it('lists and counts every row except expired ones', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const kept: number[] = [];
    for (const [index, status] of ONE_OF_EACH_STATUS.entries()) {
      const transaction = await addTransaction(em, household, { amount: -10, date: new Date(Date.UTC(2026, 6, 10 + index)), status });
      if (status !== 'EXPIRED') kept.push(transaction.transactionKey);
    }

    for (const scope of ['all-accounts', { accountKey: household.account.accountKey }] as const) {
      const page = await listTransactions({ filters: {}, limit: 50, scope, tenantKey: household.tenant.tenantKey, viewerAppuserKey: household.appuser.appuserKey });

      expect(page.transactions.map((row) => row.transactionKey).sort()).toEqual([...kept].sort());
      expect(page.total).toBe(3);
    }
  });
});
