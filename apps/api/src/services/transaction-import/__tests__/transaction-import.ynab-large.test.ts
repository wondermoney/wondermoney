import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/recurring/post-transaction-ingestion-detection.service', () => ({ triggerRecurringDetectionAfterTransactionIngestion: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@service/transaction-enrichment/transaction-enrichment-enqueue.service', () => ({ enqueueTransactionEnrichmentForTenant: vi.fn().mockResolvedValue(undefined) }));

import { addCategory, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { DI } from '@app/database/di';
import { Account } from '@entity/Account';
import { Transaction } from '@entity/Transaction';
import { TransactionType } from '@entity/TransactionType';

import { TransactionImportService } from '../transaction-import.service';

import { ynabFile, type YnabLine, ynabStorage } from './ynab-import-helpers';

/**
 * The job heartbeats between commit chunks and must do so within a minute
 * (`transaction-import.queue.ts`, `heartbeatSeconds: 60`); the settle step after the last chunk
 * runs without one. The whole commit staying under that bounds every stretch between heartbeats.
 */
const HEARTBEAT_BUDGET_MS = 60_000;

/*
 * A YNAB budget of 5,000 rows over three accounts, with transfers and categories, commits in full
 * within the job's heartbeat budget, on a real Postgres server.
 */
describe.runIf(process.env['TEST_POSTGRES_URL'])('committing a large YNAB export', () => {
  const db = useTestDatabase({ postgresUrl: process.env['TEST_POSTGRES_URL'] });

  it('writes 5,000 rows, with both sides of every transfer linked, within the heartbeat budget', { timeout: 180_000 }, async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    for (const name of ['DEPOSIT', 'PAYMENT', 'TRANSFER_IN', 'TRANSFER_OUT']) em.create(TransactionType, { displayName: name, name }, { partial: true });
    await em.flush();
    await addCategory(db.em(), household, 'Groceries');
    await addCategory(db.em(), household, 'Electricity');

    const lines: YnabLine[] = [];
    const day = (index: number) => {
      const date = new Date(Date.UTC(2020, 0, 1) + index * 86_400_000);
      return `${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}/${date.getUTCFullYear()}`;
    };
    const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    // 200 transfers, each on its own day with its own amount, both sides: 400 rows.
    for (let index = 0; index < 200; index++) {
      lines.push({ account: 'Checking', date: day(index * 7), outflow: money(10_000 + index * 101), payee: 'Transfer : Savings' });
      lines.push({ account: 'Savings', date: day(index * 7), inflow: money(10_000 + index * 101), payee: 'Transfer : Checking' });
    }
    for (let index = 0; lines.length < 5000; index++) {
      const account = index % 3 === 0 ? 'Credit Card' : 'Checking';
      const category: [string, string] = index % 2 === 0 ? ['Everyday Expenses', 'Groceries'] : ['Bills', 'Electricity'];
      lines.push({ account, category, date: day(index % 1400), outflow: money(100 + (index % 9000)), payee: `Merchant ${index % 150}` });
    }
    expect(lines).toHaveLength(5000);

    const ctx = ynabStorage();
    const service = () => new TransactionImportService(DI.em.fork(), { enqueue: ctx.enqueue, storage: ctx.storage });
    const runLastJob = () => {
      const job = ctx.sent.at(-1)!;
      return service().run(job.data.correlationId, `job-${ctx.sent.length}`, job.data.mode);
    };
    const scope = { appuserKey: household.appuser.appuserKey, tenantKey: household.tenant.tenantKey };
    const key = ctx.upload(household.account, ynabFile('web', lines));
    const created = await service().create(scope, { accountId: household.account.accountKey, format: 'ynab', key });
    await runLastJob();
    await service().setAccountMapping(scope, created.id, { Checking: household.account.accountKey }, { create: ['Savings', 'Credit Card'] });

    const started = Date.now();
    await service().commit(scope, created.id);
    await runLastJob();
    const elapsed = Date.now() - started;

    const view = await service().get(scope, created.id, {});
    expect(view.session.status).toBe('succeeded');
    expect(view.session.counts).toMatchObject({ failed: 0, imported: 5000 });
    expect(elapsed).toBeLessThan(HEARTBEAT_BUDGET_MS);

    const savings = await db.em().findOneOrFail(Account, { accountName: 'Savings', tenantKey: household.tenant }, { filters: false });
    const transfersIn = await db.em().find(Transaction, { accountKey: savings }, { filters: false, populate: ['transactionTypeKey'] });
    expect(transfersIn).toHaveLength(200);
    expect(transfersIn.every((row) => row.transactionTypeKey?.name === 'TRANSFER_IN' && row.transferCounterpartKey != null)).toBe(true);
  });
});
