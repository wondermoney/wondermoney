import { describe, expect, it, vi } from 'vitest';

import { addAccount, currencyFor, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { pgBossJob } from '@app/__tests__/__helpers__/pgboss-job';
import { BackgroundOperationStatus } from '@entity/BackgroundOperation';
import { ExchangeRate } from '@entity/ExchangeRate';
import { FxStatus, Transaction } from '@entity/Transaction';
import backgroundOperationService from '@service/operations/background-operation.service';

import { handleFxReconvertJob } from '../fx-reconvert.worker';

describe('fx re-conversion job', () => {
  const db = useTestDatabase();

  async function seedMissingRow() {
    const em = db.em();
    const household = await seedHousehold(em);
    const usd = await currencyFor(em, 'USD');
    const account = await addAccount(em, household, { balance: 1000, currency: usd });
    const yesterday = new Date(Date.now() - 86_400_000);
    em.create(Transaction, {
      accountKey: account,
      appuserCurrencyKey: household.currency,
      appuserKey: household.appuser,
      fxStatus: FxStatus.MISSING,
      settlementAmount: -100,
      settlementCurrencyKey: usd,
      tenantKey: household.tenant,
      transactionDate: yesterday,
      transactionStatusKey: household.statuses.BOOKED,
    }, { partial: true });
    em.create(ExchangeRate, { date: yesterday, fromCurrency: usd, rate: 0.9, toCurrency: household.currency }, { partial: true });
    await em.flush();
  }

  it('records its counts on a background operation the admin list shows', async () => {
    await seedMissingRow();

    await expect(handleFxReconvertJob(pgBossJob({ correlationId: 'fx.reconvert:test-1' }, { id: 'job-1' }))).resolves.toBe(true);

    const [operation] = await backgroundOperationService.listAdminOperations({ limit: 10, offset: 0, type: 'fx.reconvert' });
    expect(operation).toMatchObject({ correlationId: 'fx.reconvert:test-1', status: BackgroundOperationStatus.SUCCEEDED });
    expect(operation?.progress).toMatchObject({ accountsRebuilt: 1, accountsRevalued: 1, dryRun: false, transactionsReconverted: 1 });
  });

  it('runs once per correlation id', async () => {
    await seedMissingRow();
    const reconvert = vi.fn().mockResolvedValue({ accountsFailed: 0, accountsRebuilt: 0, accountsRevalued: 0, accountsScanned: 0, dryRun: false, transactionsReconverted: 0, transactionsScanned: 0 });
    const job = pgBossJob({ correlationId: 'fx.reconvert:test-2' }, { id: 'job-2' });

    await handleFxReconvertJob(job, { reconvert });
    await expect(handleFxReconvertJob(job, { reconvert })).resolves.toBe(false);

    expect(reconvert).toHaveBeenCalledOnce();
  });

  it('shows a run with failed accounts as partial', async () => {
    const reconvert = vi.fn().mockResolvedValue({ accountsFailed: 2, accountsRebuilt: 5, accountsRevalued: 5, accountsScanned: 7, dryRun: false, transactionsReconverted: 9, transactionsScanned: 12 });

    await handleFxReconvertJob(pgBossJob({ correlationId: 'fx.reconvert:test-4' }, { id: 'job-4' }), { reconvert });

    expect(await backgroundOperationService.findByCorrelation('fx.reconvert:test-4')).toMatchObject({ progress: { accountsFailed: 2 }, status: BackgroundOperationStatus.PARTIAL });
  });

  it('leaves the operation retryable and rethrows when the run fails', async () => {
    const reconvert = vi.fn().mockRejectedValue(new Error('database went away'));

    await expect(handleFxReconvertJob(pgBossJob({ correlationId: 'fx.reconvert:test-3' }, { id: 'job-3' }), { reconvert })).rejects.toThrow('database went away');

    const operation = await backgroundOperationService.findByCorrelation('fx.reconvert:test-3');
    expect(operation).toMatchObject({ errorCode: 'fx_reconvert_failed', status: BackgroundOperationStatus.QUEUED });
  });
});
