import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

import { addAccount, addPartner, addTransaction, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { BackgroundOperation } from '@entity/BackgroundOperation';
import { Transaction } from '@entity/Transaction';
import { type AccountRecalculationResult, runAccountRecalculation, startAccountRecalculation } from '@service/account/account-recalculation.service';

/*
 * Two people can press "Recalculate balances" on the same account at once, from two devices or
 * two household members. Starts are serialised per account and runs take turns on the account's
 * row lock, so the account ends up rebuilt once and the second run finds nothing left to fix.
 * Two sessions contending need a real server; PGlite is a single backend (see `pg-test-db.ts`).
 */
describe.runIf(process.env['TEST_POSTGRES_URL'])('recalculating one account from two places at once', () => {
  const db = useTestDatabase({ postgresUrl: process.env['TEST_POSTGRES_URL'] });

  async function corruptedAccount() {
    const em = db.em();
    const household = await seedHousehold(em);
    const partner = await addPartner(em, household);
    const account = await addAccount(em, household, { appuserCurrencyBalance: 500, balance: 500, name: 'Wallet' });
    account.openingBalance = 100;
    await em.flush();
    for (const [amount, stored] of [[50, 1], [-20, 2], [10, 3]] as const) {
      await addTransaction(em, household, { account, amount, appuserCurrencyBalance: stored, date: new Date(Date.UTC(2026, 0, 5 + stored, 12)), status: 'BOOKED' });
    }
    const scope = (appuserKey: number) => ({ accountKey: account.accountKey, appuserKey, tenantKey: household.tenant.tenantKey });
    return { account, household, owner: scope(household.appuser.appuserKey), partner: scope(partner.appuserKey) };
  }

  it('queues one operation when the same member starts it several times at once', async () => {
    const { account, owner } = await corruptedAccount();
    const send = vi.fn().mockResolvedValue('job-1');

    const starts = await Promise.all(Array.from({ length: 4 }, () => startAccountRecalculation(db.em(), owner, { enqueue: { send, sendAfter: vi.fn() } }, { rateLimited: false })));

    expect(new Set(starts.map((start) => start.operationId)).size).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    await expect(db.em().count(BackgroundOperation, { resourceId: `account:${account.accountKey}` })).resolves.toBe(1);
  });

  it('runs two recalculations of one account one after the other', async () => {
    const { account, owner, partner } = await corruptedAccount();
    const send = vi.fn().mockResolvedValueOnce('job-1').mockResolvedValueOnce('job-2');
    const first = await startAccountRecalculation(db.em(), owner, { enqueue: { send, sendAfter: vi.fn() } });
    const second = await startAccountRecalculation(db.em(), partner, { enqueue: { send, sendAfter: vi.fn() } }, { rateLimited: false });

    await Promise.all([runAccountRecalculation(db.em(), first.operationId, 'job-1'), runAccountRecalculation(db.em(), second.operationId, 'job-2')]);

    const results = await Promise.all([first, second].map(async ({ operationId }) => (await db.em().findOneOrFail(BackgroundOperation, { correlationId: operationId })).progress as unknown as AccountRecalculationResult));
    // Whichever ran first fixed every row; the other found the chain already right.
    expect(results.map((result) => result.rowsChanged).sort()).toEqual([0, 3]);
    const rows = await db.em().find(Transaction, { accountKey: { accountKey: account.accountKey } }, { filters: false, orderBy: { transactionDate: 'asc' } });
    expect(rows.map((row) => row.balance)).toEqual([150, 130, 140]);
  });
});
