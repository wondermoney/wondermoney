import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

import { addAccount, addPartner, addTransaction, currencyFor, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Account } from '@entity/Account';
import { BackgroundOperation, BackgroundOperationStatus } from '@entity/BackgroundOperation';
import { EnableBankingConnection, EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';
import { EnableBankingCredential } from '@entity/EnableBankingCredential';
import { ExchangeRate } from '@entity/ExchangeRate';
import { FxStatus, Transaction } from '@entity/Transaction';
import { TransactionAuditActorType, TransactionAuditEventType, TransactionAuditLog } from '@entity/TransactionAuditLog';
import {
  type AccountRecalculationResult,
  recalculateAccount,
  runAccountRecalculation,
  startAccountRecalculation,
} from '@service/account/account-recalculation.service';
import backgroundOperationService from '@service/operations/background-operation.service';
import { TooManyRequestsError } from '@utils/errors';

/*
 * Recalculating an account rebuilds its running balances from the one value that survived: the
 * opening balance for a manual or CSV account, the provider's balance for a synced one. Amounts
 * stored without a usable rate are converted again, the balance in the owner's currency is
 * refreshed, and every row it corrects is audited. A correct account changes nothing, so running
 * it twice is harmless.
 */
describe('recalculating an account', () => {
  const db = useTestDatabase();
  const day = (iso: string) => new Date(`${iso}T12:00:00Z`);
  const NOW = day('2026-03-10');

  /** A manual account opened with 100, holding +50, -20, +10, whose stored chain is corrupted. */
  async function corruptedManualAccount() {
    const em = db.em();
    const household = await seedHousehold(em);
    const account = await addAccount(em, household, { appuserCurrencyBalance: 500, balance: 500, name: 'Wallet' });
    account.openingBalance = 100;
    account.openingBalanceDate = day('2026-01-01');
    await em.flush();
    const rows = [
      await addTransaction(em, household, { account, amount: 50, appuserCurrencyBalance: 150, date: day('2026-01-05'), status: 'BOOKED' }),
      await addTransaction(em, household, { account, amount: -20, appuserCurrencyBalance: 999, date: day('2026-01-06'), status: 'BOOKED' }),
      await addTransaction(em, household, { account, amount: 10, appuserCurrencyBalance: 1009, date: day('2026-01-07'), status: 'BOOKED' }),
    ];
    return { account, household, rows };
  }

  async function linkToBank(em: EntityManager, household: Household, account: Account) {
    const credential = em.create(EnableBankingCredential, { applicationId: `app-${household.appuser.appuserKey}`, appuserKey: household.appuser, encryptionKeyVersion: 1, privateKeyAuthTag: 'tag', privateKeyCiphertext: 'cipher', privateKeyIv: 'iv', tenantKey: household.tenant }, { partial: true });
    const connection = em.create(EnableBankingConnection, { appuserKey: household.appuser, aspspCountry: 'PT', aspspName: 'Bank', enableBankingCredentialKey: credential, sessionId: `session-${account.accountKey}`, state: `state-${account.accountKey}`, status: EnableBankingConnectionStatus.LINKED, tenantKey: household.tenant }, { partial: true });
    await em.flush();
    const managed = await em.findOneOrFail(Account, { accountKey: account.accountKey }, { filters: false });
    managed.enableBankingConnectionKey = connection;
    await em.flush();
  }

  const reload = (key: number) => db.em().findOneOrFail(Transaction, { transactionKey: key }, { filters: false });
  const reloadAccount = (key: number) => db.em().findOneOrFail(Account, { accountKey: key }, { filters: false });
  const balances = async (rows: Transaction[]) => Promise.all(rows.map(async (row) => (await reload(row.transactionKey)).balance));

  describe('rebuilding the running balance', () => {
    it('fixes a corrupted manual chain from the opening balance and reports what changed', async () => {
      const { account, rows } = await corruptedManualAccount();

      const result = await recalculateAccount(db.em(), account.accountKey, { now: NOW });

      expect(await balances(rows)).toEqual([150, 130, 140]);
      const after = await reloadAccount(account.accountKey);
      expect(after.balance).toBe(140);
      expect(after.appuserCurrencyBalance).toBe(140);
      expect(result).toMatchObject({ balanceAfter: 140, balanceBefore: 500, rowsChanged: 2, rowsScanned: 3 } satisfies Partial<AccountRecalculationResult>);
    });

    it('changes no rows on an account that is already correct, so a second run is a no-op', async () => {
      const { account, rows } = await corruptedManualAccount();
      await recalculateAccount(db.em(), account.accountKey, { now: NOW });

      const again = await recalculateAccount(db.em(), account.accountKey, { now: NOW });

      expect(again).toMatchObject({ amountsReconverted: 0, balanceAfter: 140, balanceBefore: 140, rowsChanged: 0, rowsScanned: 3 });
      expect(await balances(rows)).toEqual([150, 130, 140]);
    });

    it('anchors a synced account on the provider balance and never overwrites it', async () => {
      const em = db.em();
      const household = await seedHousehold(em);
      const account = await addAccount(em, household, { appuserCurrencyBalance: 1000, balance: 1000, name: 'Bank' });
      await linkToBank(em, household, account);
      const rows = [
        await addTransaction(em, household, { account, amount: 100, appuserCurrencyBalance: 7, date: day('2026-02-01'), status: 'BOOKED' }),
        await addTransaction(em, household, { account, amount: -50, appuserCurrencyBalance: 8, date: day('2026-02-02'), status: 'BOOKED' }),
      ];

      const result = await recalculateAccount(db.em(), account.accountKey, { now: NOW });

      expect(await balances(rows)).toEqual([1050, 1000]);
      expect((await reloadAccount(account.accountKey)).balance).toBe(1000);
      expect(result).toMatchObject({ balanceAfter: 1000, balanceBefore: 1000, rowsChanged: 2 });
    });

    it('leaves pending rows out of the chain', async () => {
      const { account, household, rows } = await corruptedManualAccount();
      const pending = await addTransaction(db.em(), household, { account, amount: -999, date: day('2026-01-08'), status: 'PENDING' });

      await recalculateAccount(db.em(), account.accountKey, { now: NOW });

      expect(await balances(rows)).toEqual([150, 130, 140]);
      expect((await reload(pending.transactionKey)).balance ?? null).toBeNull();
    });

    it('audits each row it corrects as a system balance recalculation', async () => {
      const { account, rows } = await corruptedManualAccount();

      await recalculateAccount(db.em(), account.accountKey, { now: NOW });

      const audits = await db.em().find(TransactionAuditLog, { eventType: TransactionAuditEventType.BALANCE_RECALC }, { orderBy: { transactionKey: 'asc' } });
      expect(audits.map((audit) => audit.transactionKey.transactionKey)).toEqual(rows.slice(1).map((row) => row.transactionKey));
      expect(audits[0]).toMatchObject({ actorType: TransactionAuditActorType.SYSTEM, changes: { balance: { from: 999, to: 130 } } });
    });
  });

  describe('currencies', () => {
    async function dollarAccount() {
      const em = db.em();
      const household = await seedHousehold(em);
      const usd = await currencyFor(em, 'USD');
      const account = await addAccount(em, household, { balance: 150, currency: usd, name: 'Dollars' });
      account.openingBalance = 100;
      account.appuserCurrencyBalance = null;
      account.fxStatus = FxStatus.MISSING;
      await em.flush();
      const row = em.create(Transaction, {
        accountKey: account,
        appuserCurrencyKey: household.currency,
        appuserKey: household.appuser,
        appuserSettlementAmount: null,
        balance: 150,
        fxStatus: FxStatus.MISSING,
        settlementAmount: 50,
        settlementCurrencyKey: usd,
        tenantKey: household.tenant,
        transactionDate: day('2026-03-02'),
        transactionStatusKey: household.statuses.BOOKED,
        transactionTypeKey: household.types.income,
      }, { partial: true });
      em.create(ExchangeRate, { date: day('2026-03-02'), fromCurrency: usd, rate: 0.5, toCurrency: household.currency }, { partial: true });
      await em.flush();
      return { account, row };
    }

    it('converts amounts that had no rate and refreshes the balance in the owner\'s currency', async () => {
      const { account, row } = await dollarAccount();

      const result = await recalculateAccount(db.em(), account.accountKey, { now: NOW });

      expect(await reload(row.transactionKey)).toMatchObject({ appuserSettlementAmount: 25, fxStatus: FxStatus.EXACT });
      expect(await reloadAccount(account.accountKey)).toMatchObject({ appuserCurrencyBalance: 75, balance: 150 });
      expect(result).toMatchObject({ amountsReconverted: 1, appuserCurrencyBalanceAfter: 75, appuserCurrencyBalanceBefore: null });
    });

    it('keeps the stored balance in the owner\'s currency when no rate converts it', async () => {
      const { account } = await dollarAccount();
      await db.em().nativeDelete(ExchangeRate, {});
      const managed = await reloadAccount(account.accountKey);
      const em = db.em();
      await em.nativeUpdate(Account, { accountKey: managed.accountKey }, { appuserCurrencyBalance: 60, fxStatus: FxStatus.PROVISIONAL });

      await recalculateAccount(db.em(), account.accountKey, { now: NOW });

      expect(await reloadAccount(account.accountKey)).toMatchObject({ appuserCurrencyBalance: 60, fxStatus: FxStatus.PROVISIONAL });
    });
  });

  describe('starting and running it in the background', () => {
    const enqueue = () => ({ send: vi.fn().mockResolvedValue('job-1'), sendAfter: vi.fn() });

    function scopeOf(household: Household, account: Account, appuserKey = household.appuser.appuserKey) {
      return { accountKey: account.accountKey, appuserKey, tenantKey: household.tenant.tenantKey };
    }

    const operation = (correlationId: string) => db.em().findOneOrFail(BackgroundOperation, { correlationId });

    it('runs a queued recalculation and records its result on the operation', async () => {
      const { account, household } = await corruptedManualAccount();
      const { operationId } = await startAccountRecalculation(db.em(), scopeOf(household, account), { enqueue: enqueue() }, { now: NOW });

      await expect(runAccountRecalculation(db.em(), operationId, 'job-1', { now: NOW })).resolves.toBe(true);

      const finished = await operation(operationId);
      expect(finished.status).toBe(BackgroundOperationStatus.SUCCEEDED);
      expect(finished.progress).toMatchObject({ accountKey: account.accountKey, balanceAfter: 140, balanceBefore: 500, rowsChanged: 2 });
      expect((await reloadAccount(account.accountKey)).balance).toBe(140);
    });

    it('answers the queued operation again instead of queueing a second one', async () => {
      const { account, household } = await corruptedManualAccount();
      const queue = enqueue();
      const first = await startAccountRecalculation(db.em(), scopeOf(household, account), { enqueue: queue }, { now: NOW });

      const second = await startAccountRecalculation(db.em(), scopeOf(household, account), { enqueue: queue }, { now: new Date(NOW.getTime() + 120_000) });

      expect(second.operationId).toBe(first.operationId);
      expect(queue.send).toHaveBeenCalledTimes(1);
    });

    it('allows one start per account a minute', async () => {
      const { account, household } = await corruptedManualAccount();
      const queue = enqueue();
      const { operationId } = await startAccountRecalculation(db.em(), scopeOf(household, account), { enqueue: queue }, { now: NOW });
      await runAccountRecalculation(db.em(), operationId, 'job-1', { now: NOW });

      const tooSoon = startAccountRecalculation(db.em(), scopeOf(household, account), { enqueue: queue }, { now: new Date(NOW.getTime() + 30_000) });
      await expect(tooSoon).rejects.toBeInstanceOf(TooManyRequestsError);
      await expect(tooSoon).rejects.toMatchObject({ retryAfter: 30 });

      const later = await startAccountRecalculation(db.em(), scopeOf(household, account), { enqueue: queue }, { now: new Date(NOW.getTime() + 61_000) });
      expect(later.operationId).not.toBe(operationId);
    });

    it('rate-limits each account on its own', async () => {
      const { account, household } = await corruptedManualAccount();
      const other = await addAccount(db.em(), household, { name: 'Other' });
      const queue = enqueue();
      await startAccountRecalculation(db.em(), scopeOf(household, account), { enqueue: queue }, { now: NOW });

      await expect(startAccountRecalculation(db.em(), scopeOf(household, other), { enqueue: queue }, { now: NOW })).resolves.toMatchObject({ operationId: expect.any(String) });
    });

    it('skips the rate limit when an opening balance edit asks for it', async () => {
      const { account, household } = await corruptedManualAccount();
      const queue = enqueue();
      const { operationId } = await startAccountRecalculation(db.em(), scopeOf(household, account), { enqueue: queue }, { now: NOW });
      await runAccountRecalculation(db.em(), operationId, 'job-1', { now: NOW });

      const edit = await startAccountRecalculation(db.em(), scopeOf(household, account), { enqueue: queue }, { now: new Date(NOW.getTime() + 1_000), rateLimited: false });

      expect(edit.operationId).not.toBe(operationId);
    });

    it('fails without touching the account when the starter can no longer see it', async () => {
      const em = db.em();
      const { account, household, rows } = await corruptedManualAccount();
      const partner = await addPartner(em, household);
      const { operationId } = await startAccountRecalculation(db.em(), scopeOf(household, account, partner.appuserKey), { enqueue: enqueue() }, { now: NOW });
      // The owner makes the account private before the job runs.
      await db.em().nativeUpdate(Account, { accountKey: account.accountKey }, { isPrivate: true });

      await runAccountRecalculation(db.em(), operationId, 'job-1', { now: NOW });

      expect((await operation(operationId)).status).toBe(BackgroundOperationStatus.FAILED);
      expect(await balances(rows)).toEqual([150, 999, 1009]);
    });

    it('does not run an operation another job owns', async () => {
      const { account, household } = await corruptedManualAccount();
      const { operationId } = await startAccountRecalculation(db.em(), scopeOf(household, account), { enqueue: enqueue() }, { now: NOW });

      await expect(runAccountRecalculation(db.em(), operationId, 'some-other-job', { now: NOW })).resolves.toBe(false);
      expect((await reloadAccount(account.accountKey)).balance).toBe(500);
    });

    it('marks the operation failed when the job cannot be queued', async () => {
      const { account, household } = await corruptedManualAccount();
      const broken = { send: vi.fn().mockRejectedValue(new Error('queue down')), sendAfter: vi.fn() };

      await expect(startAccountRecalculation(db.em(), scopeOf(household, account), { enqueue: broken }, { now: NOW })).rejects.toThrow('queue down');

      const operations = await db.em().find(BackgroundOperation, { operationType: 'account.recalculate' });
      expect(operations.map((row) => row.status)).toEqual([BackgroundOperationStatus.FAILED]);
    });

    it('queues the next run while one is going, since runs take turns on the account', async () => {
      const { account, household } = await corruptedManualAccount();
      const queue = enqueue();
      const first = await startAccountRecalculation(db.em(), scopeOf(household, account), { enqueue: queue }, { now: NOW });
      await backgroundOperationService.claimJobStartOrResume(first.operationId, 'job-1');

      const next = await startAccountRecalculation(db.em(), scopeOf(household, account), { enqueue: queue }, { now: new Date(NOW.getTime() + 61_000) });

      expect(next.operationId).not.toBe(first.operationId);
      expect((await operation(next.operationId)).status).toBe(BackgroundOperationStatus.QUEUED);
    });
  });
});
