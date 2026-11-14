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
import backgroundOperationService from '@service/operations/background-operation.service';

import { TransactionImportService } from '../transaction-import.service';

import { actualFile, type ActualLine } from './actual-import-helpers';
import { ynabStorage } from './ynab-import-helpers';

/**
 * The job must heartbeat within a minute (`transaction-import.queue.ts`, `heartbeatSeconds: 60`):
 * between commit chunks, and on a timer while the accounts settle after the last one. No stretch
 * of the commit goes longer than that without a heartbeat.
 */
const HEARTBEAT_BUDGET_MS = 60_000;

/*
 * An Actual Budget export of 10,000 lines over three accounts, with transfers, splits and
 * categories, commits in full on a real Postgres server, with its progress readable from the
 * session while it runs.
 *
 * A perf test (`pnpm test:perf`), outside the default run: its timing only means something on a
 * machine that is not also running other suites.
 */
describe.runIf(process.env['TEST_POSTGRES_URL'])('committing a large Actual Budget export', () => {
  const db = useTestDatabase({ postgresUrl: process.env['TEST_POSTGRES_URL'] });

  it('writes a 10,000-line file chunk by chunk, its progress visible on the session, within the heartbeat budget', { timeout: 300_000 }, async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    for (const name of ['DEPOSIT', 'PAYMENT', 'TRANSFER_IN', 'TRANSFER_OUT']) em.create(TransactionType, { displayName: name, name }, { partial: true });
    await em.flush();
    await addCategory(db.em(), household, 'Groceries');
    await addCategory(db.em(), household, 'Electricity');

    const day = (index: number) => new Date(Date.UTC(2020, 0, 1) + index * 86_400_000).toISOString().slice(0, 10);
    const money = (cents: number) => String(cents / 100);
    const lines: ActualLine[] = [];
    // 100 transfers, each on its own day with its own amount, both sides: 200 lines.
    for (let index = 0; index < 100; index++) {
      lines.push({ account: 'Checking', amount: money(-(10_000 + index * 101)), date: day(index * 7), payee: 'Savings' });
      lines.push({ account: 'Savings', amount: money(10_000 + index * 101), date: day(index * 7), payee: 'Checking' });
    }
    // 100 splits of two parts: 300 lines, 100 transactions.
    for (let index = 0; index < 100; index++) {
      const date = day(index * 5 + 3);
      lines.push({ account: 'Checking', amount: '0', date, notes: '(SPLIT INTO 2) ', payee: `Market ${index}`, splitAmount: money(-(3000 + index)) });
      lines.push({ account: 'Checking', amount: money(-2000), category: 'Groceries', date, notes: '(SPLIT 1 OF 2) ', payee: `Market ${index}` });
      lines.push({ account: 'Checking', amount: money(-(1000 + index)), category: 'Electricity', date, notes: '(SPLIT 2 OF 2) ', payee: `Market ${index}` });
    }
    for (let index = 0; lines.length < 10_000; index++) {
      const account = index % 3 === 0 ? 'Credit Card' : 'Checking';
      lines.push({ account, amount: money(-(100 + (index % 9000))), category: index % 2 === 0 ? 'Groceries' : 'Electricity', date: day(index % 1400), payee: `Merchant ${index % 150}` });
    }
    expect(lines).toHaveLength(10_000);
    const expectedRows = 10_000 - 200;

    const ctx = ynabStorage();
    const progress: { imported: number; status: string; total: number }[] = [];
    const heartbeats: number[] = [];
    const scope = { appuserKey: household.appuser.appuserKey, tenantKey: household.tenant.tenantKey };
    let sessionId = '';
    const observer = () => new TransactionImportService(DI.em.fork());
    const service = () => new TransactionImportService(DI.em.fork(), {
      enqueue: ctx.enqueue,
      onChunk: async (index) => {
        // Every few chunks, read the session as the review polls it, between two chunks.
        if (index % 4 === 2) {
          const { session } = await observer().get(scope, sessionId, { pageSize: 1 });
          progress.push({ imported: session.counts.imported, status: session.status, total: session.counts.imported + session.decisions.import });
        }
      },
      storage: ctx.storage,
    });
    const runLastJob = () => {
      const job = ctx.sent.at(-1);
      if (!job) throw new Error('no job queued');
      return service().run(job.data.correlationId, `job-${ctx.sent.length}`, job.data.mode);
    };
    const key = ctx.upload(household.account, actualFile(lines));
    const created = await service().create(scope, { accountId: household.account.accountKey, format: 'actual', key });
    sessionId = created.id;
    await runLastJob();
    await service().setAccountMapping(scope, created.id, { Checking: household.account.accountKey }, { create: ['Savings', 'Credit Card'] });

    const heartbeat = backgroundOperationService.heartbeatJob.bind(backgroundOperationService);
    vi.spyOn(backgroundOperationService, 'heartbeatJob').mockImplementation((...args) => {
      heartbeats.push(Date.now());
      return heartbeat(...args);
    });
    const started = Date.now();
    await service().commit(scope, created.id);
    await runLastJob();
    const finished = Date.now();
    vi.restoreAllMocks();

    const view = await service().get(scope, created.id, {});
    expect(view.session.status).toBe('succeeded');
    expect(view.session.counts).toMatchObject({ failed: 0, imported: expectedRows, invalid: 0 });

    // The review saw the commit part way, each time further along, out of the same total.
    expect(progress.length).toBeGreaterThan(2);
    expect(progress.every((step) => step.status === 'importing' && step.total === expectedRows && step.imported > 0 && step.imported < expectedRows)).toBe(true);
    expect(progress.map((step) => step.imported)).toEqual([...progress.map((step) => step.imported)].sort((a, b) => a - b));
    expect(new Set(progress.map((step) => step.imported)).size).toBe(progress.length);

    const marks = [started, ...heartbeats, finished];
    const gaps = marks.slice(1).map((mark, index) => mark - (marks[index] ?? mark));
    expect(heartbeats.length).toBeGreaterThan(expectedRows / 500);
    expect(Math.max(...gaps)).toBeLessThan(HEARTBEAT_BUDGET_MS);
    expect(finished - started).toBeLessThan(5 * HEARTBEAT_BUDGET_MS);

    const savings = await db.em().findOneOrFail(Account, { accountName: 'Savings', tenantKey: household.tenant }, { filters: false });
    const transfersIn = await db.em().find(Transaction, { accountKey: savings }, { filters: false, populate: ['transactionTypeKey'] });
    expect(transfersIn).toHaveLength(100);
    expect(transfersIn.every((row) => row.transactionTypeKey?.name === 'TRANSFER_IN' && row.transferCounterpartKey != null)).toBe(true);
    expect(await db.em().count(Transaction, { accountKey: household.account, notes: { $like: 'Groceries -20.00; Electricity %' } }, { filters: false })).toBe(100);
  });
});
