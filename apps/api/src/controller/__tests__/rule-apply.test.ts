import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import express from 'express';

import { addMerchant, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { BackgroundOperation, BackgroundOperationStatus } from '@entity/BackgroundOperation';
import { Rule, RuleMatchMode } from '@entity/Rule';
import { Transaction } from '@entity/Transaction';
import ruleRoutes from '@route/rule';

/*
 * `POST /v1/rule/:ruleId/apply` and `POST /v1/rule/apply-all`: a dry run answers how many
 * transactions would change and writes nothing; a real one queues a background run and answers
 * its operation id. Which transactions a run reaches is `rule-run.test.ts`'s concern.
 */
describe('applying rules over HTTP', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const send = vi.fn().mockResolvedValue('job-1');
  const withQueue = express.Router();
  withQueue.use((req, _res, next) => {
    req.enqueue = { send, sendAfter: vi.fn() };
    next();
  });
  withQueue.use(ruleRoutes);
  const http = tenantHttp('/v1/rule', withQueue);
  beforeEach(() => send.mockClear());

  async function householdWithRule(): Promise<{ household: Household; payment: Transaction; rule: Rule }> {
    const em = db.em();
    const household = await seedHousehold(em);
    const rule = em.create(Rule, { actions: [{ type: 'hide' }], active: true, conditions: [{ field: 'merchant', operator: 'contains', value: 'netflix' }], match: RuleMatchMode.ALL, name: 'Netflix', ownerAppuserKey: household.appuser, position: 0, stopProcessing: false, tenantKey: household.tenant, version: 1 }, { partial: true });
    await em.flush();
    const payment = await addTransaction(em, household, { amount: -12.99, date: new Date('2026-07-10T12:00:00Z'), merchant: await addMerchant(em, household, 'Netflix'), status: 'BOOKED' });
    return { household, payment, rule };
  }

  const hidden = async (payment: Transaction) => (await db.em().findOneOrFail(Transaction, { transactionKey: payment.transactionKey }, { filters: false })).hidden;

  it('counts without writing on a dry run', async () => {
    const { household, payment, rule } = await householdWithRule();

    const one = await http.as(household.appuser).post(`/v1/rule/${rule.ruleKey}/apply`).send({ dryRun: true });
    const all = await http.as(household.appuser).post('/v1/rule/apply-all').send({});

    expect(one.status).toBe(200);
    expect(one.body).toEqual({ changeCount: 1 });
    expect(all.body).toEqual({ changeCount: 1 });
    expect(await hidden(payment)).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('queues a run the member who started it can follow', async () => {
    const { household, rule } = await householdWithRule();

    const response = await http.as(household.appuser).post(`/v1/rule/${rule.ruleKey}/apply`).send({ dryRun: false });

    expect(response.status).toBe(202);
    expect(send).toHaveBeenCalledWith('rule.apply', { correlationId: response.body.operationId }, expect.anything());
    expect(await db.em().findOneOrFail(BackgroundOperation, { correlationId: response.body.operationId })).toMatchObject({ status: BackgroundOperationStatus.QUEUED });
    const again = await http.as(household.appuser).post('/v1/rule/apply-all').send({ dryRun: false });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: 'rule_apply_in_progress' });
  });

  it('does not find another household\'s rule', async () => {
    const { rule } = await householdWithRule();
    const neighbour = await seedHousehold(db.em());

    const response = await http.as(neighbour.appuser).post(`/v1/rule/${rule.ruleKey}/apply`).send({ dryRun: true });

    expect(response.status).toBe(404);
  });
});
