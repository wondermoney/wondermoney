import { describe, expect, it, vi } from 'vitest';

import { addAccount, currencyFor, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { pgBossJob } from '@app/__tests__/__helpers__/pgboss-job';
import { BackgroundOperationStatus } from '@entity/BackgroundOperation';
import { ExchangeRate } from '@entity/ExchangeRate';
import { ExchangeRateOverride } from '@entity/ExchangeRateOverride';
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

  it('re-converts only the household pair named by an override change', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const neighbour = await seedHousehold(em);
    const xof = await currencyFor(em, 'XOF');
    const day = new Date(Date.now() - 86_400_000);
    const rowIn = async (owner: typeof household) => em.create(Transaction, {
      accountKey: await addAccount(em, owner, { balance: 1000, currency: xof }),
      appuserCurrencyKey: owner.currency,
      appuserKey: owner.appuser,
      fxStatus: FxStatus.MISSING,
      settlementAmount: -10_000,
      settlementCurrencyKey: xof,
      tenantKey: owner.tenant,
      transactionDate: day,
      transactionStatusKey: owner.statuses.BOOKED,
    }, { partial: true });
    const mine = await rowIn(household);
    const theirs = await rowIn(neighbour);
    // Both households have the same override; the job names only the first.
    for (const owner of [household, neighbour]) em.create(ExchangeRateOverride, { date: day, fromCurrency: xof, rate: 0.0015, tenantKey: owner.tenant, toCurrency: owner.currency }, { partial: true });
    await em.flush();

    const payload = { correlationId: 'fx.reconvert:override-1', override: { fromCurrency: 'XOF', tenantKey: household.tenant.tenantKey, toCurrency: 'EUR' } };
    await expect(handleFxReconvertJob(pgBossJob(payload, { id: 'job-5' }))).resolves.toBe(true);

    const reload = (row: Transaction) => db.em().findOneOrFail(Transaction, { transactionKey: row.transactionKey }, { filters: false });
    expect(await reload(mine)).toMatchObject({ appuserSettlementAmount: -15, fxStatus: FxStatus.EXACT });
    expect(await reload(theirs)).toMatchObject({ appuserSettlementAmount: null, fxStatus: FxStatus.MISSING });
    expect(await backgroundOperationService.findByCorrelation('fx.reconvert:override-1')).toMatchObject({ progress: { transactionsReconverted: 1 }, status: BackgroundOperationStatus.SUCCEEDED });
  });

  it('leaves the operation retryable and rethrows when the run fails', async () => {
    const reconvert = vi.fn().mockRejectedValue(new Error('database went away'));

    await expect(handleFxReconvertJob(pgBossJob({ correlationId: 'fx.reconvert:test-3' }, { id: 'job-3' }), { reconvert })).rejects.toThrow('database went away');

    const operation = await backgroundOperationService.findByCorrelation('fx.reconvert:test-3');
    expect(operation).toMatchObject({ errorCode: 'fx_reconvert_failed', status: BackgroundOperationStatus.QUEUED });
  });
});
