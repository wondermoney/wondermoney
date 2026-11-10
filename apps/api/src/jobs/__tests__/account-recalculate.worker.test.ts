import { describe, expect, it, vi } from 'vitest';

import { addTransaction, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { pgBossJob } from '@app/__tests__/__helpers__/pgboss-job';
import { Account } from '@entity/Account';
import { BackgroundOperation, BackgroundOperationStatus } from '@entity/BackgroundOperation';
import { startAccountRecalculation } from '@service/account/account-recalculation.service';
import backgroundOperationService from '@service/operations/background-operation.service';

import { handleAccountRecalculateJob } from '../account-recalculate.worker';

describe('account recalculate job', () => {
  const db = useTestDatabase();

  async function queuedRun() {
    const em = db.em();
    const household = await seedHousehold(em);
    household.account.openingBalance = 100;
    await em.flush();
    await addTransaction(em, household, { amount: 25, appuserCurrencyBalance: 9, date: new Date('2026-07-10T12:00:00Z'), status: 'BOOKED' });
    const scope = { accountKey: household.account.accountKey, appuserKey: household.appuser.appuserKey, tenantKey: household.tenant.tenantKey };
    const { operationId } = await startAccountRecalculation(db.em(), scope, { enqueue: { send: vi.fn().mockResolvedValue('job-1'), sendAfter: vi.fn() } });
    return { account: household.account, operationId };
  }

  const operation = (correlationId: string) => db.em().findOneOrFail(BackgroundOperation, { correlationId });

  it('rebuilds the account and finishes the operation with what changed', async () => {
    const { account, operationId } = await queuedRun();

    await expect(handleAccountRecalculateJob(pgBossJob({ correlationId: operationId }, { id: 'job-1', retryLimit: 2 }))).resolves.toBe(true);

    expect(await operation(operationId)).toMatchObject({ progress: { balanceAfter: 125, balanceBefore: 1000, rowsChanged: 1 }, status: BackgroundOperationStatus.SUCCEEDED });
    expect(await db.em().findOneOrFail(Account, { accountKey: account.accountKey }, { filters: false })).toMatchObject({ balance: 125 });
  });

  it('puts a failed attempt back in the queue while pg-boss has retries left, and fails the run on the last one', async () => {
    const { operationId } = await queuedRun();
    const failure = new Error('database went away');
    const run = async (_em: unknown, correlationId: string, jobId: string): Promise<boolean> => {
      await backgroundOperationService.claimJobStartOrResume(correlationId, jobId);
      throw failure;
    };

    await expect(handleAccountRecalculateJob(pgBossJob({ correlationId: operationId }, { id: 'job-1', retryCount: 0, retryLimit: 2 }), { run })).rejects.toBe(failure);
    expect(await operation(operationId)).toMatchObject({ status: BackgroundOperationStatus.QUEUED });

    await expect(handleAccountRecalculateJob(pgBossJob({ correlationId: operationId }, { id: 'job-1', retryCount: 2, retryLimit: 2 }), { run })).rejects.toBe(failure);
    expect(await operation(operationId)).toMatchObject({ errorCode: 'account.recalculate:failed', status: BackgroundOperationStatus.FAILED });
  });

  it('ignores a job without an operation id', async () => {
    await expect(handleAccountRecalculateJob(pgBossJob({}, { id: 'job-1' }))).resolves.toBe(false);
  });
});
