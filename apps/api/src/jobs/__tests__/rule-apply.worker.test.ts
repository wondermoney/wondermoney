import { describe, expect, it, vi } from 'vitest';

import { addMerchant, addTransaction, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { pgBossJob } from '@app/__tests__/__helpers__/pgboss-job';
import { BackgroundOperation, BackgroundOperationStatus } from '@entity/BackgroundOperation';
import { Rule, RuleMatchMode } from '@entity/Rule';
import { Transaction } from '@entity/Transaction';
import backgroundOperationService from '@service/operations/background-operation.service';
import { startRuleRun } from '@service/rules/rule-run.service';

import { handleRuleApplyJob } from '../rule-apply.worker';

describe('rule apply job', () => {
  const db = useTestDatabase();

  async function queuedRun() {
    const em = db.em();
    const household = await seedHousehold(em);
    const rule = em.create(Rule, { actions: [{ type: 'hide' }], active: true, conditions: [{ field: 'merchant', operator: 'contains', value: 'netflix' }], match: RuleMatchMode.ALL, name: 'Netflix', ownerAppuserKey: household.appuser, position: 0, stopProcessing: false, tenantKey: household.tenant, version: 1 }, { partial: true });
    await em.flush();
    const merchant = await addMerchant(em, household, 'Netflix');
    const payment = await addTransaction(em, household, { amount: -12.99, date: new Date('2026-07-10T12:00:00Z'), merchant, status: 'BOOKED' });
    const { operationId } = await startRuleRun(db.em(), { appuserKey: household.appuser.appuserKey, ruleKey: rule.ruleKey, tenantKey: household.tenant.tenantKey }, { enqueue: { send: vi.fn().mockResolvedValue('job-1'), sendAfter: vi.fn() } });
    return { operationId, payment };
  }

  const operation = (correlationId: string) => db.em().findOneOrFail(BackgroundOperation, { correlationId });

  it('applies the rules and finishes the operation', async () => {
    const { operationId, payment } = await queuedRun();

    await expect(handleRuleApplyJob(pgBossJob({ correlationId: operationId }, { id: 'job-1', retryLimit: 3 }))).resolves.toBe(true);

    expect(await operation(operationId)).toMatchObject({ progress: { changed: 1, processed: 1, total: 1 }, status: BackgroundOperationStatus.SUCCEEDED });
    expect(await db.em().findOneOrFail(Transaction, { transactionKey: payment.transactionKey }, { filters: false })).toMatchObject({ hidden: true });
  });

  it('puts a failed attempt back in the queue while pg-boss has retries left, and fails the run on the last one', async () => {
    const { operationId } = await queuedRun();
    const failure = new Error('database went away');
    // Claims the run, as the real one does, then fails part-way.
    const run = async (_em: unknown, correlationId: string, jobId: string): Promise<boolean> => {
      await backgroundOperationService.claimJobStartOrResume(correlationId, jobId);
      throw failure;
    };

    await expect(handleRuleApplyJob(pgBossJob({ correlationId: operationId }, { id: 'job-1', retryCount: 0, retryLimit: 3 }), { run })).rejects.toBe(failure);
    expect(await operation(operationId)).toMatchObject({ errorCode: 'rule.apply:failed', status: BackgroundOperationStatus.QUEUED });

    await expect(handleRuleApplyJob(pgBossJob({ correlationId: operationId }, { id: 'job-1', retryCount: 3, retryLimit: 3 }), { run })).rejects.toBe(failure);
    expect(await operation(operationId)).toMatchObject({ errorCode: 'rule.apply:failed', status: BackgroundOperationStatus.FAILED });
  });

  it('ignores a job without an operation id', async () => {
    await expect(handleRuleApplyJob(pgBossJob({}, { id: 'job-1' }))).resolves.toBe(false);
  });
});
