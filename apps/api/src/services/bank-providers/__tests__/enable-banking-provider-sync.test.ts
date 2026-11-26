import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Enable Banking answers over HTTP; everything from there to the database is real: the API client's
 * error mapping, the provider, the sync adapter, both sync phases. The stub stands in for Enable
 * Banking itself, routing each request by path, so these tests say what a household sees when a
 * bank answers badly.
 */
const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return { ...actual, default: { ...actual.default, create: vi.fn(() => ({ get: http.get, post: http.post })) } };
});
vi.mock('@service/enable-banking/enable-banking-jwt.service', () => ({ signEnableBankingJwt: vi.fn().mockResolvedValue('signed.jwt') }));
vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

import type { transactionImport } from '@wondermoney/shared';

import { addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { DI } from '@app/database/di';
import { updateTransaction } from '@controller/account/transactions';
import { Account } from '@entity/Account';
import { AccountFinancialInstitution, AccountFinancialInstitutionProvider } from '@entity/AccountFinancialInstitution';
import { BankConnection, BankConnectionStatus } from '@entity/BankConnection';
import { EnableBankingConnection, EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';
import { Transaction } from '@entity/Transaction';
import { TransactionType } from '@entity/TransactionType';
import accountInitialSyncAccountService from '@service/account/account-initial-sync-account.service';
import accountInitialSyncTransactionService from '@service/account/account-initial-sync-transaction.service';
import { recalculateAccount } from '@service/account/account-recalculation.service';
import { runBankSyncPhases } from '@service/bank-sync-run/bank-sync-run';
import { createEnableBankingClient } from '@service/enable-banking/enable-banking-client.service';
import type { Enqueue } from '@service/queue/enqueue';
import { TransactionImportService, type TransactionImportStorage } from '@service/transaction-import/transaction-import.service';
import { deriveChainWithoutProviderBalance } from '@service/transaction/balance-chain.service';
import { transactionCreationService } from '@service/transaction/transaction-creation.service';
import { deleteTransactions } from '@service/transaction/transaction-deletion.service';
import { buildEnableBankingInstitutionRecordId } from '@utils/enable-banking-institution-id';
import logger from '@utils/logger';

import { EnableBankingProvider } from '../enable-banking.provider';

const BANK = { country: 'ES', name: 'Test Bank' };
const ACCOUNT_UID = 'eb-account-1';
const LAST_REFRESH = new Date('2026-11-01T08:00:00Z');

interface StubResponse { data?: unknown; status: number }

/** An Axios rejection carrying an Enable Banking `ErrorResponse`, as the real API sends one. */
function enableBankingFailure(status: number, body: unknown): AxiosError {
  const response = { config: { headers: new AxiosHeaders() }, data: body, headers: new AxiosHeaders(), status, statusText: 'error' } as AxiosResponse;
  return new AxiosError(`Request failed with status code ${status}`, String(status), undefined, undefined, response);
}

function timeout(): AxiosError {
  return new AxiosError('timeout of 15000ms exceeded', 'ECONNABORTED');
}

/** Routes `GET /accounts/{uid}/balances` and `/transactions` to the given answers. */
function stubEnableBanking(answers: { balances: AxiosError | StubResponse; transactions: (params: { date_from?: string }) => AxiosError | StubResponse }) {
  const transactionCalls: { date_from?: string; date_to?: string }[] = [];
  http.get.mockImplementation((url: string, config?: { params?: { date_from?: string; date_to?: string } }) => {
    const answer = url.endsWith('/balances')
      ? answers.balances
      : url.endsWith('/transactions')
        ? (transactionCalls.push({ ...config?.params }), answers.transactions(config?.params ?? {}))
        : enableBankingFailure(404, { message: 'not stubbed' });
    return answer instanceof AxiosError ? Promise.reject(answer) : Promise.resolve({ data: answer.data });
  });
  return { transactionCalls };
}

const booked = (id: string, date: string, amount: string, indicator: 'CRDT' | 'DBIT') => ({
  booking_date: date,
  credit_debit_indicator: indicator,
  entry_reference: id,
  remittance_information: [`Row ${id}`],
  status: 'BOOK',
  transaction_amount: { amount, currency: 'EUR' },
});

describe('an Enable Banking bank that answers badly still syncs what it can', () => {
  const db = useTestDatabase();
  const provider = new EnableBankingProvider({ clientFor: () => createEnableBankingClient({ applicationId: 'app-1', privateKeyPem: 'unused' }) });

  beforeEach(() => vi.clearAllMocks());

  /** A linked connection with one synced account: balance 500 (or none), one booked row carrying it. */
  async function linkedBank(input: { balance?: null | number } = {}) {
    const balance = input.balance === undefined ? 500 : input.balance;
    const em = db.em();
    const household = await seedHousehold(em);
    for (const name of ['CARD_PAYMENT', 'DEPOSIT', 'PAYMENT']) {
      if (!(await em.findOne(TransactionType, { name }))) em.create(TransactionType, { displayName: name, name }, { partial: true });
    }
    const connection = em.create(BankConnection, {
      accessValidUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      appuserKey: household.appuser,
      externalId: 'session-1',
      provider: 'enable_banking',
      status: BankConnectionStatus.LINKED,
      tenantKey: household.tenant,
    }, { partial: true });
    const enableBankingConnection = em.create(EnableBankingConnection, {
      accessValidUntil: connection.accessValidUntil,
      appuserKey: household.appuser,
      aspspCountry: BANK.country,
      aspspName: BANK.name,
      bankConnectionKey: connection,
      sessionId: 'session-1',
      state: 'state-1',
      status: EnableBankingConnectionStatus.LINKED,
      tenantKey: household.tenant,
    }, { partial: true });
    const institution = em.create(AccountFinancialInstitution, {
      displayName: BANK.name,
      id: buildEnableBankingInstitutionRecordId(BANK),
      name: BANK.name,
      provider: AccountFinancialInstitutionProvider.ENABLE_BANKING,
    }, { partial: true });
    const account = em.create(Account, {
      accountFinancialInstitutionKey: institution,
      accountId: ACCOUNT_UID,
      accountName: 'Checking',
      accountOwnerAppuserKey: household.appuser,
      appuserCurrencyBalance: balance ?? undefined,
      balance: balance ?? undefined,
      bankConnectionKey: connection,
      closed: false,
      // Both keys, as a linked Enable Banking account has them: the chain treats it as a bank account.
      currencyKey: household.currency,
      enableBankingConnectionKey: enableBankingConnection,
      isPrivate: false,
      refreshedAt: LAST_REFRESH,
      tenantKey: household.tenant,
    }, { partial: true });
    await em.flush();
    const earlier = await addTransaction(em, household, { account, amount: 500, appuserCurrencyBalance: balance ?? undefined, date: new Date('2026-10-01T12:00:00Z'), enableBankingTransactionId: 'earlier', status: 'BOOKED' });
    return { account, connection, earlier, household };
  }

  function sync(household: Household, connection: BankConnection, fetchWindowDays: number) {
    return runBankSyncPhases({
      accountService: accountInitialSyncAccountService,
      connection: {
        appuserId: household.appuser.appuserKey,
        bankConnectionKey: connection.bankConnectionKey,
        externalId: 'session-1',
        provider: 'enable_banking',
        status: BankConnectionStatus.LINKED,
        tenantId: household.tenant.tenantKey,
      },
      correlationId: 'correlation-1',
      fetchWindowDays,
      provider,
      queueJobId: 'job-1',
      transactionService: accountInitialSyncTransactionService,
    });
  }

  /** A member edits a row's amount through the transactions controller. */
  async function editAmount(household: Household, transactionKey: number, updatedAmount: number) {
    const next = vi.fn();
    const res = { json: () => res, status: () => res } as unknown as Response;
    const req = { body: { updatedAmount }, headers: {}, params: { transactionId: String(transactionKey) }, query: {}, tenant: household.tenant, user: household.appuser } as unknown as Request;
    await (updateTransaction as (req: Request, res: Response, next: (error?: unknown) => void) => Promise<unknown>)(req, res, next);
    expect(next.mock.calls[0]?.[0]).toBeUndefined();
  }

  async function rowsOf(account: Account) {
    return db.em().find(Transaction, { accountKey: { accountKey: account.accountKey } }, { filters: false, orderBy: { transactionDate: 'ASC' } });
  }

  const balancesRefused = () => enableBankingFailure(400, { code: 400, error: 'ASPSP_ERROR', message: 'Error interacting with ASPSP' });
  const balancesOk = (amount: string) => ({ data: { balances: [{ balance_amount: { amount, currency: 'EUR' }, balance_type: 'CLBD' }] }, status: 200 });

  describe('when the balances call fails', () => {
    it.each([
      ['rejects it (400)', balancesRefused(), false],
      ['times out', timeout(), true],
    ] as const)('syncs the transactions and keeps the last balance when Enable Banking %s', async (_case, failure, retryable) => {
      const { account, connection, earlier, household } = await linkedBank();
      stubEnableBanking({ balances: failure, transactions: () => ({ data: { transactions: [booked('new-1', '2026-11-20', '12.50', 'DBIT')] }, status: 200 }) });

      const result = await sync(household, connection, 5);

      // Partial, recorded under the code that says the transactions synced without a balance: it
      // waits, never asks for a reconnect, and is not the generic "your bank isn't available".
      expect(result).toMatchObject({ reportedErrorCode: 'balance_unavailable', status: 'partial' });
      expect(result.everyAccountRejected).toBeFalsy();
      // A refusal would be refused again tomorrow, so it is not retried; a timeout may pass.
      expect(result.partialRetryable).toBe(retryable ? undefined : false);
      expect(result.transaction?.status).toBe('full_success');

      const rows = await db.em().find(Transaction, { accountKey: { accountKey: account.accountKey } }, { filters: false, orderBy: { transactionDate: 'ASC' } });
      expect(rows.map((row) => row.enableBankingTransactionId)).toEqual(['earlier', 'new-1']);
      expect(rows[1]?.settlementAmount).toBe(-12.5);

      // The bank gave no balance, so it is derived from the stored chain: the row that held 500 keeps
      // it, the new row follows from it, and the account ends where the chain does. `refreshedAt`
      // still says when the bank last gave a real balance.
      const after = await db.em().findOneOrFail(Account, { accountKey: account.accountKey }, { filters: false });
      expect(after).toMatchObject({ appuserCurrencyBalance: 487.5, balance: 487.5 });
      expect(after.refreshedAt).toEqual(LAST_REFRESH);
      // Marked as derived, so web and mobile say how old the bank's own figure is.
      expect(after.balanceDerivedAt).toBeInstanceOf(Date);
      const earlierAfter = await db.em().findOneOrFail(Transaction, { transactionKey: earlier.transactionKey }, { filters: false });
      expect(earlierAfter.balance).toBe(500);
      expect(rows[1]?.balance).toBe(487.5);
    });

    it('keeps the stored balances when rows older than every stored one arrive', async () => {
      const { account, connection, earlier, household } = await linkedBank();
      stubEnableBanking({ balances: balancesRefused(), transactions: () => ({ data: { transactions: [booked('old-1', '2026-09-01', '100.00', 'CRDT'), booked('new-1', '2026-11-20', '12.50', 'DBIT')] }, status: 200 }) });

      await sync(household, connection, 365);

      const rows = await rowsOf(account);
      expect(rows.map((row) => [row.enableBankingTransactionId, row.balance])).toEqual([['old-1', 0], ['earlier', 500], ['new-1', 487.5]]);
      expect(rows.find((row) => row.transactionKey === earlier.transactionKey)?.balance).toBe(500);
      expect((await db.em().findOneOrFail(Account, { accountKey: account.accountKey }, { filters: false })).balance).toBe(487.5);
    });

    it('keeps the chain consistent when the bank cancels a stored row', async () => {
      const { account, connection, household } = await linkedBank();
      const em = db.em();
      await addTransaction(em, household, { account, amount: -40, appuserCurrencyBalance: 460, date: new Date('2026-10-10T12:00:00Z'), enableBankingTransactionId: 'mid', status: 'BOOKED' });
      await addTransaction(em, household, { account, amount: -10, appuserCurrencyBalance: 450, date: new Date('2026-10-20T12:00:00Z'), enableBankingTransactionId: 'late', status: 'BOOKED' });
      await em.nativeUpdate(Account, { accountKey: account.accountKey }, { appuserCurrencyBalance: 450, balance: 450 });
      stubEnableBanking({ balances: balancesRefused(), transactions: () => ({ data: { transactions: [{ ...booked('mid', '2026-10-10', '40.00', 'DBIT'), status: 'CNCL' }] }, status: 200 }) });

      await sync(household, connection, 365);

      // `mid` left the chain: `late` follows from `earlier` alone, and the account from `late`.
      const settled = (await rowsOf(account)).filter((row) => row.enableBankingTransactionId !== 'mid');
      expect(settled.map((row) => [row.enableBankingTransactionId, row.balance])).toEqual([['earlier', 500], ['late', 490]]);
      expect((await db.em().findOneOrFail(Account, { accountKey: account.accountKey }, { filters: false })).balance).toBe(490);
    });

    it('leaves a derived chain as it is when the account is recalculated', async () => {
      const { account, connection, household } = await linkedBank();
      stubEnableBanking({ balances: balancesRefused(), transactions: () => ({ data: { transactions: [booked('new-1', '2026-11-20', '12.50', 'DBIT')] }, status: 200 }) });
      await sync(household, connection, 5);

      await recalculateAccount(db.em(), account.accountKey);

      expect((await rowsOf(account)).map((row) => [row.enableBankingTransactionId, row.balance])).toEqual([['earlier', 500], ['new-1', 487.5]]);
      expect((await db.em().findOneOrFail(Account, { accountKey: account.accountKey }, { filters: false })).balance).toBe(487.5);
    });

    it('keeps no derived mark once the bank sends a balance again', async () => {
      const { account, connection, household } = await linkedBank();
      stubEnableBanking({ balances: balancesRefused(), transactions: () => ({ data: { transactions: [booked('new-1', '2026-11-20', '12.50', 'DBIT')] }, status: 200 }) });
      await sync(household, connection, 5);
      stubEnableBanking({ balances: balancesOk('487.50'), transactions: () => ({ data: { transactions: [] }, status: 200 }) });

      const result = await sync(household, connection, 5);

      expect(result.status).toBe('full_success');
      const after = await db.em().findOneOrFail(Account, { accountKey: account.accountKey }, { filters: false });
      expect(after.balanceDerivedAt).toBeNull();
      expect(after.refreshedAt?.getTime()).toBeGreaterThan(LAST_REFRESH.getTime());
    });

    it('does not mark the balance derived when the bank gives one', async () => {
      const { account, connection, household } = await linkedBank();
      stubEnableBanking({ balances: balancesOk('487.50'), transactions: () => ({ data: { transactions: [booked('new-1', '2026-11-20', '12.50', 'DBIT')] }, status: 200 }) });

      await sync(household, connection, 5);

      expect((await db.em().findOneOrFail(Account, { accountKey: account.accountKey }, { filters: false })).balanceDerivedAt).toBeNull();
    });

    describe('when the bank sends a balance again after one was derived', () => {
      /** Derives 487.50 (500 - 12.50), then syncs a 10.00 debit with the bank's balance `real`. */
      async function realBalanceAfterDerived(real: string) {
        const bank = await linkedBank();
        stubEnableBanking({ balances: balancesRefused(), transactions: () => ({ data: { transactions: [booked('new-1', '2026-11-20', '12.50', 'DBIT')] }, status: 200 }) });
        await sync(bank.household, bank.connection, 5);
        const info = vi.spyOn(logger, 'info');
        stubEnableBanking({ balances: balancesOk(real), transactions: () => ({ data: { transactions: [booked('new-2', '2026-11-22', '10.00', 'DBIT')] }, status: 200 }) });
        await sync(bank.household, bank.connection, 5);
        const drift = info.mock.calls.filter(([, message]) => message === 'Bank balance replaced a derived balance').map(([context]) => context);
        info.mockRestore();
        return { ...bank, drift };
      }

      it.each([
        ['matches what the chain would have derived', '477.50', false],
        ['differs from what the chain would have derived', '470.00', true],
      ] as const)('logs, with no amount, whether the bank\'s balance %s', async (_case, real, differed) => {
        const { account, connection, drift } = await realBalanceAfterDerived(real);

        // Only the ids and the yes or no: never a balance or an amount.
        expect(drift).toEqual([{ accountKey: account.accountKey, bankConnectionKey: connection.bankConnectionKey, differed }]);
        // The bank's figure wins either way: the chain is rebuilt backwards from it.
        const rows = await rowsOf(account);
        expect(rows.at(-1)?.balance).toBe(Number(real));
      });

      it('logs nothing on the syncs after that', async () => {
        const { connection, household } = await realBalanceAfterDerived('477.50');
        const info = vi.spyOn(logger, 'info');
        stubEnableBanking({ balances: balancesOk('477.50'), transactions: () => ({ data: { transactions: [] }, status: 200 }) });

        await sync(household, connection, 5);

        expect(info.mock.calls.some(([, message]) => message === 'Bank balance replaced a derived balance')).toBe(false);
        info.mockRestore();
      });
    });

    describe('when a statement import adds rows newer than the last sync to a derived balance', () => {
      /** A one-step statement import of `rows` into the account, run as its worker would. */
      async function importRows(household: Household, account: Account, rows: { amount: number; date: string; id: string }[]) {
        const adapter: transactionImport.ImportAdapter = {
          format: 'statement',
          parse: () => Promise.resolve({
            rows: rows.map((row, index) => ({ normalized: { amount: row.amount, date: row.date, description: `Statement ${row.id}`, externalId: row.id }, raw: {}, sourceRow: index + 2 })),
            sourceAccounts: [],
            warnings: [],
          }),
        };
        const sent: { correlationId: string; mode: 'commit' | 'parse' }[] = [];
        const enqueue: Enqueue = { send: (_queue, data) => Promise.resolve(`job-${sent.push(data as (typeof sent)[number])}`), sendAfter: () => Promise.resolve(null) };
        const storage: TransactionImportStorage = {
          getAccountCsvBucketName: () => 'csv',
          getObjectBuffer: () => Promise.resolve(Buffer.from('ignored')),
          getObjectSize: () => Promise.resolve(7),
          presignAccountUpload: () => Promise.reject(new Error('not used')),
        };
        const service = () => new TransactionImportService(DI.em.fork(), { adapters: { statement: adapter }, enqueue, storage });
        const scope = { appuserKey: household.appuser.appuserKey, tenantKey: household.tenant.tenantKey };
        await service().create(scope, { accountId: account.accountKey, autoCommit: true, format: 'statement', key: `account-${account.accountKey}-generic-statement.csv` });
        const job = sent.at(-1)!;
        await expect(service().run(job.correlationId, `job-${sent.length}`, job.mode)).resolves.toBe(true);
      }

      it('settles them so that the next derivation, and the next refused sync, agree with what it wrote', async () => {
        const { account, connection, household } = await linkedBank();
        stubEnableBanking({ balances: balancesRefused(), transactions: () => ({ data: { transactions: [booked('new-1', '2026-11-20', '12.50', 'DBIT')] }, status: 200 }) });
        await sync(household, connection, 5);
        const derived = await db.em().findOneOrFail(Account, { accountKey: account.accountKey }, { filters: false });
        expect(derived.balance).toBe(487.5);
        expect(derived.balanceDerivedAt).toBeInstanceOf(Date);

        await importRows(household, account, [{ amount: -20, date: '2026-11-22T00:00:00.000Z', id: 'statement-1' }, { amount: 100, date: '2026-11-24T00:00:00.000Z', id: 'statement-2' }]);

        // The import continues the chain from the last synced row, and the account ends where it does.
        const imported = await rowsOf(account);
        expect(imported.map((row) => row.balance)).toEqual([500, 487.5, 467.5, 567.5]);
        const afterImport = await db.em().findOneOrFail(Account, { accountKey: account.accountKey }, { filters: false });
        expect(afterImport.balance).toBe(567.5);

        // Deriving again from the stored chain changes nothing and lands on the same balance.
        const em = db.em().fork();
        const again = await deriveChainWithoutProviderBalance(em, await em.findOneOrFail(Account, { accountKey: account.accountKey }, { filters: false }));
        expect(again).toMatchObject({ changed: 0, derived: true, tail: { balance: 567.5 } });

        // So does the next sync whose balance the bank refuses again.
        stubEnableBanking({ balances: balancesRefused(), transactions: () => ({ data: { transactions: [] }, status: 200 }) });
        await sync(household, connection, 5);
        expect((await rowsOf(account)).map((row) => row.balance)).toEqual([500, 487.5, 467.5, 567.5]);
        expect((await db.em().findOneOrFail(Account, { accountKey: account.accountKey }, { filters: false })).balance).toBe(567.5);
      });
    });

    it('keeps the account balance right when a member edits a row the sync added without a balance', async () => {
      const { account, connection, household } = await linkedBank();
      stubEnableBanking({ balances: balancesRefused(), transactions: () => ({ data: { transactions: [booked('r1', '2026-11-19', '50.00', 'DBIT'), booked('r2', '2026-11-20', '20.00', 'DBIT')] }, status: 200 }) });
      await sync(household, connection, 5);
      const [, r1, r2] = await rowsOf(account);
      expect([r1?.balance, r2?.balance]).toEqual([450, 430]);

      await editAmount(household, r2!.transactionKey, -15);

      const after = await db.em().findOneOrFail(Account, { accountKey: account.accountKey }, { filters: false });
      // 500 - 50 - 15: the chain the edit recomputes opens on the row before it.
      expect(after).toMatchObject({ appuserCurrencyBalance: 435, balance: 435 });
      expect(after.fxStatus).not.toBe('missing');
    });

    it('opens an edit on the first stored balance when the row before it has none', async () => {
      const { account, household } = await linkedBank();
      const em = db.em();
      // Rows stored without a running balance, as an earlier build did.
      await addTransaction(em, household, { account, amount: -50, date: new Date('2026-11-19T12:00:00Z'), enableBankingTransactionId: 'r1', status: 'BOOKED' });
      const r2 = await addTransaction(em, household, { account, amount: -20, date: new Date('2026-11-20T12:00:00Z'), enableBankingTransactionId: 'r2', status: 'BOOKED' });

      await editAmount(household, r2.transactionKey, -15);

      // Never the sum of the suffix (-15), and the stored 500 stays where it is.
      expect((await rowsOf(account)).map((row) => row.balance)).toEqual([500, 450, 435]);
      expect((await db.em().findOneOrFail(Account, { accountKey: account.accountKey }, { filters: false })).balance).toBe(435);
    });

    it('writes no balance anywhere for an account that has never had one, even after an edit', async () => {
      const { account, connection, household } = await linkedBank({ balance: null });
      stubEnableBanking({ balances: balancesRefused(), transactions: () => ({ data: { transactions: [booked('r1', '2026-11-19', '50.00', 'DBIT'), booked('r2', '2026-11-20', '20.00', 'DBIT')] }, status: 200 }) });

      const result = await sync(household, connection, 5);
      expect(result.status).toBe('partial');
      const [, , r2] = await rowsOf(account);
      await editAmount(household, r2!.transactionKey, -15);

      const after = await db.em().findOneOrFail(Account, { accountKey: account.accountKey }, { filters: false });
      expect(after.balance).toBeNull();
      expect((await rowsOf(account)).map((row) => [row.enableBankingTransactionId, row.balance])).toEqual([['earlier', null], ['r1', null], ['r2', null]]);
    });

    describe('on an account linked only through its bank connection, as a SimpleFIN one is', () => {
      async function simplefinShaped() {
        const bank = await linkedBank();
        const em = db.em();
        const account = await em.findOneOrFail(Account, { accountKey: bank.account.accountKey }, { filters: false });
        account.enableBankingConnectionKey = undefined;
        // What the account phase stores on the first balance it ever reads.
        account.openingBalance = 500;
        await em.flush();
        return bank;
      }

      it('rebuilds a synced chain backwards from the bank balance, not forwards from the opening one', async () => {
        const { account, connection, household } = await simplefinShaped();
        stubEnableBanking({ balances: balancesOk('430.00'), transactions: () => ({ data: { transactions: [booked('h1', '2026-10-15', '50.00', 'DBIT'), booked('h2', '2026-11-01', '20.00', 'DBIT')] }, status: 200 }) });

        await sync(household, connection, 365);

        expect((await rowsOf(account)).map((row) => [row.enableBankingTransactionId, row.balance])).toEqual([['earlier', 500], ['h1', 450], ['h2', 430]]);
        expect((await db.em().findOneOrFail(Account, { accountKey: account.accountKey }, { filters: false })).balance).toBe(430);
      });

      it('derives the balance from the chain when the bank then refuses one', async () => {
        const { account, connection, household } = await simplefinShaped();
        stubEnableBanking({ balances: balancesOk('430.00'), transactions: () => ({ data: { transactions: [booked('h1', '2026-10-15', '50.00', 'DBIT'), booked('h2', '2026-11-01', '20.00', 'DBIT')] }, status: 200 }) });
        await sync(household, connection, 365);
        stubEnableBanking({ balances: balancesRefused(), transactions: () => ({ data: { transactions: [booked('n1', '2026-11-20', '10.00', 'DBIT')] }, status: 200 }) });

        await sync(household, connection, 5);

        // 430 - 10, never the opening balance plus every row (920).
        expect((await rowsOf(account)).map((row) => row.balance)).toEqual([500, 450, 430, 420]);
        expect((await db.em().findOneOrFail(Account, { accountKey: account.accountKey }, { filters: false })).balance).toBe(420);
      });
    });

    it('adds and removes a row by hand on an account that has never had a balance without inventing one', async () => {
      const { account, connection, household } = await linkedBank({ balance: null });
      stubEnableBanking({ balances: balancesRefused(), transactions: () => ({ data: { transactions: [booked('r1', '2026-11-19', '50.00', 'DBIT')] }, status: 200 }) });
      await sync(household, connection, 5);

      const cash = await transactionCreationService.createTransaction({
        accountId: account.accountKey,
        appuserKey: household.appuser.appuserKey,
        description: 'cash',
        enteredByHand: true,
        settlementAmount: -5,
        settlementCurrencyId: household.currency.currencyKey,
        transactionDate: new Date('2026-11-21T12:00:00Z'),
        transactionMerchantName: 'Cash',
        transactionTypeId: household.types.cardPayment.transactionTypeKey,
      }) as unknown as { transactionKey: number };

      const accountBalance = async () => (await db.em().findOneOrFail(Account, { accountKey: account.accountKey }, { filters: false })).balance;
      expect(await accountBalance()).toBeNull();
      expect((await rowsOf(account)).map((row) => row.balance)).toEqual([null, null, null]);

      stubEnableBanking({ balances: balancesRefused(), transactions: () => ({ data: { transactions: [booked('r2', '2026-11-22', '20.00', 'DBIT')] }, status: 200 }) });
      await sync(household, connection, 5);
      expect(await accountBalance()).toBeNull();
      expect((await rowsOf(account)).every((row) => row.balance == null)).toBe(true);

      const doomed = await db.em().find(Transaction, { transactionKey: cash.transactionKey }, { filters: false, populate: ['accountKey'] });
      await deleteTransactions(db.em(), { appuserKey: household.appuser.appuserKey, tenantKey: household.tenant.tenantKey }, doomed);
      expect(await accountBalance()).toBeNull();
      expect((await rowsOf(account)).filter((row) => row.deletedAt == null).every((row) => row.balance == null)).toBe(true);
    });

    it('stops at a rate limit the bank relays, whatever the HTTP status', async () => {
      const { connection, household } = await linkedBank();
      stubEnableBanking({
        balances: enableBankingFailure(400, { code: 400, error: 'ASPSP_RATE_LIMIT_EXCEEDED', message: 'ASPSP Rate limit exceeded' }),
        transactions: () => ({ data: { transactions: [] }, status: 200 }),
      });

      const result = await sync(household, connection, 5);

      expect(result).toMatchObject({ failedAt: 'account', rateLimited: {} });
      expect(http.get.mock.calls.some(([url]) => String(url).endsWith('/transactions'))).toBe(false);
    });

    it.each([
      ['a 401', enableBankingFailure(401, { code: 401, error: 'EXPIRED_SESSION', message: 'Session expired' })],
      ['a session-ended code on a 400', enableBankingFailure(400, { code: 400, error: 'REVOKED_SESSION', message: 'Session revoked' })],
      ['a session that does not exist', enableBankingFailure(404, { code: 404, error: 'SESSION_DOES_NOT_EXIST', message: 'Session does not exist' })],
      ['a session in the wrong status', enableBankingFailure(400, { code: 400, error: 'WRONG_SESSION_STATUS', message: 'Wrong session status' })],
    ] as const)('still fails the account, so the worker checks the consent, on %s', async (_case, failure) => {
      const { connection, household } = await linkedBank();
      stubEnableBanking({ balances: failure, transactions: () => ({ data: { transactions: [] }, status: 200 }) });

      const result = await sync(household, connection, 5);

      expect(result).toMatchObject({ everyAccountRejected: true, failedAt: 'account', status: 'failed' });
    });
  });

  describe('when the bank refuses the transaction period', () => {
    const wrongPeriod = () => enableBankingFailure(422, { code: 422, error: 'WRONG_TRANSACTIONS_PERIOD', message: 'Wrong transactions period requested' });
    /** 89 days counting today: a day's margin under PSD2's 90 for a bank counting in its own time zone. */
    const fallbackFrom = () => {
      const today = new Date();
      return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 88)).toISOString().slice(0, 10);
    };

    it('asks once more for the last 89 days and syncs what that returns', async () => {
      const { account, connection, household } = await linkedBank();
      const { transactionCalls } = stubEnableBanking({
        balances: { data: { balances: [{ balance_amount: { amount: '487.50', currency: 'EUR' }, balance_type: 'CLBD' }] }, status: 200 },
        transactions: (params) => (params.date_from ?? '') < fallbackFrom() ? wrongPeriod() : { data: { transactions: [booked('recent-1', '2026-11-20', '12.50', 'DBIT')] }, status: 200 },
      });

      const result = await sync(household, connection, 365);

      expect(result.status).toBe('full_success');
      expect(transactionCalls).toHaveLength(2);
      expect(transactionCalls[1]?.date_from).toBe(fallbackFrom());
      const rows = await db.em().find(Transaction, { accountKey: { accountKey: account.accountKey }, enableBankingTransactionId: 'recent-1' }, { filters: false });
      expect(rows).toHaveLength(1);
      // The balance came back, so the chain is rebuilt from it as usual.
      expect(rows[0]?.balance).toBe(487.5);
    });

    it('records the shorter window it used', async () => {
      const { household } = await linkedBank();
      const em = db.em();
      const connection = await em.findOneOrFail(BankConnection, { externalId: 'session-1' });
      stubEnableBanking({
        balances: { data: { balances: [{ balance_amount: { amount: '487.50', currency: 'EUR' }, balance_type: 'CLBD' }] }, status: 200 },
        transactions: (params) => (params.date_from ?? '') < fallbackFrom() ? wrongPeriod() : { data: { transactions: [] }, status: 200 },
      });

      const result = await accountInitialSyncTransactionService.syncTransactionsForRequisition({
        connection: { appuserId: household.appuser.appuserKey, bankConnectionKey: connection.bankConnectionKey, externalId: 'session-1', provider: 'enable_banking', status: BankConnectionStatus.LINKED },
        fetchWindowDays: 365,
      }, { provider });

      expect(result.historyShortened).toEqual([{ accountId: ACCOUNT_UID, fetchedFrom: fallbackFrom() }]);
    });

    it('asks the next full sync for the shorter window straight away', async () => {
      const { account, connection, household } = await linkedBank();
      const answers = {
        balances: { data: { balances: [{ balance_amount: { amount: '487.50', currency: 'EUR' }, balance_type: 'CLBD' }] }, status: 200 },
        transactions: (params: { date_from?: string }) => (params.date_from ?? '') < fallbackFrom() ? wrongPeriod() : { data: { transactions: [booked('recent-1', '2026-11-20', '12.50', 'DBIT')] }, status: 200 },
      };
      stubEnableBanking(answers);
      await sync(household, connection, 365);
      const { transactionCalls } = stubEnableBanking(answers);

      const result = await sync(household, connection, 365);

      // One call, for the window the bank served last time: no refused request first.
      expect(transactionCalls.map((call) => call.date_from)).toEqual([fallbackFrom()]);
      expect(result.status).toBe('full_success');
      expect((await rowsOf(account)).map((row) => row.enableBankingTransactionId)).toEqual(['earlier', 'recent-1']);
    });

    it('still asks a short refresh for its own short window', async () => {
      const { connection, household } = await linkedBank();
      const answers = {
        balances: { data: { balances: [{ balance_amount: { amount: '487.50', currency: 'EUR' }, balance_type: 'CLBD' }] }, status: 200 },
        transactions: (params: { date_from?: string }) => (params.date_from ?? '') < fallbackFrom() ? wrongPeriod() : { data: { transactions: [] }, status: 200 },
      };
      stubEnableBanking(answers);
      await sync(household, connection, 365);
      const { transactionCalls } = stubEnableBanking(answers);

      await sync(household, connection, 5);

      const fiveDaysAgo = new Date();
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
      expect(transactionCalls.map((call) => call.date_from)).toEqual([fiveDaysAgo.toISOString().slice(0, 10)]);
    });

    it('keeps the long window for an account the bank did not refuse, or did not serve', async () => {
      const { account, connection, household } = await linkedBank();
      const em = db.em();
      // A second account on the same connection, and a third.
      const second = em.create(Account, { accountFinancialInstitutionKey: account.accountFinancialInstitutionKey, accountId: 'eb-account-2', accountName: 'Savings', accountOwnerAppuserKey: household.appuser, balance: 100, bankConnectionKey: connection, closed: false, currencyKey: household.currency, enableBankingConnectionKey: account.enableBankingConnectionKey, isPrivate: false, tenantKey: household.tenant }, { partial: true });
      const third = em.create(Account, { accountFinancialInstitutionKey: account.accountFinancialInstitutionKey, accountId: 'eb-account-3', accountName: 'Card', accountOwnerAppuserKey: household.appuser, balance: 0, bankConnectionKey: connection, closed: false, currencyKey: household.currency, enableBankingConnectionKey: account.enableBankingConnectionKey, isPrivate: false, tenantKey: household.tenant }, { partial: true });
      await em.flush();
      const calls: { account: string; date_from?: string }[] = [];
      let firstRun = true;
      http.get.mockImplementation((url: string, config?: { params?: { date_from?: string } }) => {
        if (url.endsWith('/balances')) return Promise.resolve({ data: { balances: [{ balance_amount: { amount: '100.00', currency: 'EUR' }, balance_type: 'CLBD' }] } });
        const uid = url.split('/').at(-2) ?? '';
        const from = config?.params?.date_from ?? '';
        calls.push({ account: uid, date_from: from });
        // The first account's bank refuses a year; the second times out on the first run.
        if (uid === ACCOUNT_UID && from < fallbackFrom()) return Promise.reject(wrongPeriod());
        if (uid === 'eb-account-2' && firstRun) return Promise.reject(timeout());
        return Promise.resolve({ data: { transactions: [] } });
      });

      await sync(household, connection, 365);
      firstRun = false;
      calls.length = 0;
      // The retry of that first sync.
      await sync(household, connection, 365);

      const yearAgo = new Date();
      yearAgo.setDate(yearAgo.getDate() - 365);
      const longFrom = yearAgo.toISOString().slice(0, 10);
      expect([...calls].sort((a, b) => a.account.localeCompare(b.account))).toEqual([
        { account: ACCOUNT_UID, date_from: fallbackFrom() },
        { account: 'eb-account-2', date_from: longFrom },
        { account: 'eb-account-3', date_from: longFrom },
      ]);
      const stored = await db.em().fork().find(Account, { accountKey: { $in: [account.accountKey, second.accountKey, third.accountKey] } }, { filters: false, orderBy: { accountKey: 'ASC' } });
      expect(stored.map((row) => row.historyWindowDays ?? null)).toEqual([88, null, null]);
    });

    it('fails the account as before when the shorter window is refused too', async () => {
      const { connection, household } = await linkedBank();
      const { transactionCalls } = stubEnableBanking({
        balances: { data: { balances: [{ balance_amount: { amount: '487.50', currency: 'EUR' }, balance_type: 'CLBD' }] }, status: 200 },
        transactions: () => wrongPeriod(),
      });

      const result = await sync(household, connection, 365);

      expect(transactionCalls).toHaveLength(2);
      expect(result).toMatchObject({ failedAt: 'transaction', status: 'failed' });
    });

    it('does not retry another 422', async () => {
      const { connection, household } = await linkedBank();
      const { transactionCalls } = stubEnableBanking({
        balances: { data: { balances: [{ balance_amount: { amount: '487.50', currency: 'EUR' }, balance_type: 'CLBD' }] }, status: 200 },
        transactions: () => enableBankingFailure(422, { code: 422, error: 'ASPSP_ERROR', message: 'Error interacting with ASPSP' }),
      });

      const result = await sync(household, connection, 365);

      expect(transactionCalls).toHaveLength(1);
      expect(result).toMatchObject({ failedAt: 'transaction', status: 'failed' });
    });
  });
});
