import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it, vi } from 'vitest';

/** An account whose running-balance rebuild blows up, to show one bad account does not stop the rest. */
const failing = vi.hoisted(() => ({ accountKey: null as null | number }));
vi.mock('@service/transaction/balance-chain.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@service/transaction/balance-chain.service')>();
  return {
    ...actual,
    recalculateChainFromAccountBalance: (...args: Parameters<typeof actual.recalculateChainFromAccountBalance>) => {
      if (args[1].accountKey === failing.accountKey) return Promise.reject(new Error('chain rebuild failed'));
      return actual.recalculateChainFromAccountBalance(...args);
    },
  };
});

import { addAccount, currencyFor, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Account } from '@entity/Account';
import { Appuser } from '@entity/Appuser';
import type { Currency } from '@entity/Currency';
import { ExchangeRate } from '@entity/ExchangeRate';
import { ExchangeRateOverride } from '@entity/ExchangeRateOverride';
import { FxStatus, Transaction } from '@entity/Transaction';
import { TransactionAuditEventType, TransactionAuditLog } from '@entity/TransactionAuditLog';

import { reconvertFx, reconvertFxForOverride } from '../fx-reconvert.service';

/*
 * Rows stored without a usable rate are converted again once one exists, and every
 * foreign-currency account balance follows the latest rate. Nothing is ever downgraded: a row
 * keeps what it has until a better rate is stored.
 */
describe('re-converting amounts when rates arrive', () => {
  const db = useTestDatabase();
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
  const NOW = day('2026-03-10');

  interface Setup {
    account: Account;
    em: EntityManager;
    eur: Currency;
    household: Household;
    usd: Currency;
  }

  async function usdAccount(input: { appuserCurrencyBalance?: null | number; balance?: number; fxStatus?: FxStatus | null } = {}): Promise<Setup> {
    const em = db.em();
    const household = await seedHousehold(em);
    const usd = await currencyFor(em, 'USD');
    const account = await addAccount(em, household, { balance: input.balance ?? 1000, currency: usd, name: 'Dollars' });
    account.appuserCurrencyBalance = input.appuserCurrencyBalance ?? null;
    account.fxStatus = input.fxStatus === undefined ? FxStatus.MISSING : input.fxStatus;
    await em.flush();
    return { account, em, eur: household.currency, household, usd };
  }

  async function addRate(em: EntityManager, from: Currency, to: Currency, date: string, rate: number) {
    em.create(ExchangeRate, { date: day(date), fromCurrency: from, rate, toCurrency: to }, { partial: true });
    await em.flush();
  }

  interface RowInput {
    amount: number;
    appuserAmount?: null | number;
    date: string;
    fxStatus: FxStatus | null;
    rate?: number;
  }

  async function addRow(setup: Setup, input: RowInput, account: Account = setup.account): Promise<Transaction> {
    const { em, household } = setup;
    const row = em.create(Transaction, {
      accountKey: account,
      appuserCurrencyExchangeRate: input.rate,
      appuserCurrencyKey: household.currency,
      appuserKey: household.appuser,
      appuserSettlementAmount: input.appuserAmount ?? null,
      fxStatus: input.fxStatus,
      settlementAmount: input.amount,
      settlementCurrencyKey: account.currencyKey,
      tenantKey: household.tenant,
      transactionDate: day(input.date),
      transactionStatusKey: household.statuses.BOOKED,
      transactionTypeKey: household.types.cardPayment,
    }, { partial: true });
    await em.flush();
    return row;
  }

  const reload = (key: number) => db.em().findOneOrFail(Transaction, { transactionKey: key }, { filters: false });
  const reloadAccount = (setup: Setup) => db.em().findOneOrFail(Account, { accountKey: setup.account.accountKey }, { filters: false });

  it('converts a row stored as missing once a rate for its date exists, and marks it exact', async () => {
    const setup = await usdAccount();
    const row = await addRow(setup, { amount: -100, date: '2026-03-02', fxStatus: FxStatus.MISSING });
    await addRate(setup.em, setup.usd, setup.eur, '2026-03-02', 0.9);

    const result = await reconvertFx(db.em(), { now: NOW });

    expect(await reload(row.transactionKey)).toMatchObject({ appuserCurrencyExchangeRate: 0.9, appuserSettlementAmount: -90, fxStatus: FxStatus.EXACT });
    expect(result.transactionsReconverted).toBe(1);
  });

  it('records each re-conversion as a system edit in the audit trail', async () => {
    const setup = await usdAccount();
    const row = await addRow(setup, { amount: -100, date: '2026-03-02', fxStatus: FxStatus.MISSING });
    await addRate(setup.em, setup.usd, setup.eur, '2026-03-02', 0.9);

    await reconvertFx(db.em(), { now: NOW });

    const audits = await db.em().find(TransactionAuditLog, { transactionKey: { transactionKey: row.transactionKey } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ eventType: TransactionAuditEventType.SYSTEM_EDIT, source: 'fx-reconvert' });
    expect(audits[0]?.changes).toEqual({
      appuserCurrencyExchangeRate: { from: null, to: 0.9 },
      appuserSettlementAmount: { from: null, to: -90 },
      fxStatus: { from: FxStatus.MISSING, to: FxStatus.EXACT },
    });
  });

  it('upgrades a provisional row once a rate inside the staleness window is stored', async () => {
    const setup = await usdAccount();
    await addRate(setup.em, setup.usd, setup.eur, '2026-02-01', 0.8);
    const row = await addRow(setup, { amount: -100, appuserAmount: -80, date: '2026-03-03', fxStatus: FxStatus.PROVISIONAL, rate: 0.8 });
    await addRate(setup.em, setup.usd, setup.eur, '2026-03-02', 0.9);

    await reconvertFx(db.em(), { now: NOW });

    expect(await reload(row.transactionKey)).toMatchObject({ appuserCurrencyExchangeRate: 0.9, appuserSettlementAmount: -90, fxStatus: FxStatus.EXACT });
  });

  it('restamps a legacy row that was stored at 1:1 with no rate', async () => {
    const setup = await usdAccount();
    const row = await addRow(setup, { amount: -100, appuserAmount: -100, date: '2026-03-02', fxStatus: null });
    await addRate(setup.em, setup.usd, setup.eur, '2026-03-02', 0.9);

    await reconvertFx(db.em(), { now: NOW });

    expect(await reload(row.transactionKey)).toMatchObject({ appuserSettlementAmount: -90, fxStatus: FxStatus.EXACT });
  });

  it('never replaces a stored amount with nothing when no rate exists yet', async () => {
    const setup = await usdAccount();
    const legacy = await addRow(setup, { amount: -100, appuserAmount: -100, date: '2026-03-02', fxStatus: null });
    const missing = await addRow(setup, { amount: -50, date: '2026-03-03', fxStatus: FxStatus.MISSING });

    const result = await reconvertFx(db.em(), { now: NOW });

    expect(await reload(legacy.transactionKey)).toMatchObject({ appuserSettlementAmount: -100, fxStatus: null });
    expect(await reload(missing.transactionKey)).toMatchObject({ appuserSettlementAmount: null, fxStatus: FxStatus.MISSING });
    expect(result.transactionsReconverted).toBe(0);
  });

  it('leaves rows already converted at a stored rate alone', async () => {
    const setup = await usdAccount();
    await addRate(setup.em, setup.usd, setup.eur, '2026-03-02', 0.9);
    const exact = await addRow(setup, { amount: -100, appuserAmount: -91, date: '2026-03-02', fxStatus: FxStatus.EXACT, rate: 0.91 });
    const legacyWithRate = await addRow(setup, { amount: -100, appuserAmount: -92, date: '2026-03-02', fxStatus: null, rate: 0.92 });

    await reconvertFx(db.em(), { now: NOW });

    expect(await reload(exact.transactionKey)).toMatchObject({ appuserSettlementAmount: -91, fxStatus: FxStatus.EXACT });
    expect(await reload(legacyWithRate.transactionKey)).toMatchObject({ appuserSettlementAmount: -92, fxStatus: null });
  });

  it('changes nothing when run a second time', async () => {
    const setup = await usdAccount();
    await addRow(setup, { amount: -100, date: '2026-03-02', fxStatus: FxStatus.MISSING });
    await addRow(setup, { amount: -50, appuserAmount: -50, date: '2026-03-03', fxStatus: null });
    await addRate(setup.em, setup.usd, setup.eur, '2026-03-02', 0.9);
    await reconvertFx(db.em(), { now: NOW });
    const before = await db.em().find(Transaction, {}, { filters: false, orderBy: { transactionKey: 'asc' } });
    const auditsBefore = await db.em().count(TransactionAuditLog, {});

    const second = await reconvertFx(db.em(), { now: NOW });

    const after = await db.em().find(Transaction, {}, { filters: false, orderBy: { transactionKey: 'asc' } });
    expect(second).toMatchObject({ accountsRebuilt: 0, accountsRevalued: 0, transactionsReconverted: 0 });
    expect(after.map(snapshot)).toEqual(before.map(snapshot));
    expect(await db.em().count(TransactionAuditLog, {})).toBe(auditsBefore);
  });

  it('rebuilds the running balance of every account it touched', async () => {
    const setup = await usdAccount({ appuserCurrencyBalance: 900, balance: 1000, fxStatus: FxStatus.EXACT });
    await addRate(setup.em, setup.usd, setup.eur, '2026-03-09', 0.9);
    const older = await addRow(setup, { amount: -100, date: '2026-03-09', fxStatus: FxStatus.MISSING });
    const newer = await addRow(setup, { amount: -50, appuserAmount: -45, date: '2026-03-09', fxStatus: FxStatus.EXACT, rate: 0.9 });

    const result = await reconvertFx(db.em(), { now: NOW });

    // The chain is anchored on the account's converted balance (900) and runs back from it.
    expect(await reload(newer.transactionKey)).toMatchObject({ appuserCurrencyBalance: 900, balance: 1000 });
    expect(await reload(older.transactionKey)).toMatchObject({ appuserCurrencyBalance: 945, balance: 1050 });
    expect(result.accountsRebuilt).toBe(1);
  });

  it('revalues a manual foreign-currency account at the latest rate', async () => {
    const setup = await usdAccount({ appuserCurrencyBalance: 800, balance: 1000, fxStatus: FxStatus.EXACT });
    await addRate(setup.em, setup.usd, setup.eur, '2026-03-01', 0.8);
    await addRate(setup.em, setup.usd, setup.eur, '2026-03-09', 0.95);

    const result = await reconvertFx(db.em(), { now: NOW });

    expect(await reloadAccount(setup)).toMatchObject({ appuserCurrencyBalance: 950, fxStatus: FxStatus.EXACT });
    expect(result.accountsRevalued).toBe(1);
  });

  it('keeps an account balance it cannot convert rather than clearing it', async () => {
    const setup = await usdAccount({ appuserCurrencyBalance: 800, balance: 1000, fxStatus: FxStatus.EXACT });

    await reconvertFx(db.em(), { now: NOW });

    expect(await reloadAccount(setup)).toMatchObject({ appuserCurrencyBalance: 800, fxStatus: FxStatus.EXACT });
  });

  it('leaves accounts in the owner currency alone', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    household.account.appuserCurrencyBalance = 123;
    await em.flush();

    const result = await reconvertFx(db.em(), { now: NOW });

    expect(await db.em().findOneOrFail(Account, { accountKey: household.account.accountKey }, { filters: false })).toMatchObject({ appuserCurrencyBalance: 123 });
    expect(result.accountsRevalued).toBe(0);
  });

  it('converts each household to its own currency', async () => {
    const setup = await usdAccount();
    const gbp = await currencyFor(setup.em, 'GBP');
    const other = await seedHousehold(setup.em);
    const owner = await setup.em.findOneOrFail(Appuser, { appuserKey: other.appuser.appuserKey });
    owner.currencyKey = gbp;
    await setup.em.flush();
    const otherAccount = await addAccount(setup.em, other, { balance: 200, currency: setup.usd, name: 'Other dollars' });
    const otherSetup: Setup = { ...setup, account: otherAccount, household: { ...other, currency: gbp } };
    const mine = await addRow(setup, { amount: -100, date: '2026-03-02', fxStatus: FxStatus.MISSING });
    const theirs = await addRow(otherSetup, { amount: -100, date: '2026-03-02', fxStatus: FxStatus.MISSING });
    await addRate(setup.em, setup.usd, setup.eur, '2026-03-02', 0.9);
    await addRate(setup.em, setup.usd, gbp, '2026-03-02', 0.75);

    await reconvertFx(db.em(), { now: NOW });

    expect(await reload(mine.transactionKey)).toMatchObject({ appuserSettlementAmount: -90 });
    expect(await reload(theirs.transactionKey)).toMatchObject({ appuserSettlementAmount: -75 });
    expect(await db.em().findOneOrFail(Account, { accountKey: otherAccount.accountKey }, { filters: false })).toMatchObject({ appuserCurrencyBalance: 150 });
    const audit = await db.em().findOneOrFail(TransactionAuditLog, { transactionKey: { transactionKey: theirs.transactionKey } }, { populate: ['tenantKey'] });
    expect(audit.tenantKey.tenantKey).toBe(other.tenant.tenantKey);
  });

  it('rolls back an account that fails, counts it, and carries on with the others', async () => {
    const setup = await usdAccount();
    const second = await addAccount(setup.em, setup.household, { balance: 10, currency: setup.usd, name: 'Second' });
    const broken = await addRow(setup, { amount: -100, date: '2026-03-02', fxStatus: FxStatus.MISSING });
    const healed = await addRow(setup, { amount: -100, date: '2026-03-02', fxStatus: FxStatus.MISSING }, second);
    await addRate(setup.em, setup.usd, setup.eur, '2026-03-02', 0.9);
    failing.accountKey = setup.account.accountKey;

    try {
      const result = await reconvertFx(db.em(), { now: NOW });

      expect(result).toMatchObject({ accountsFailed: 1, transactionsReconverted: 1 });
      expect(await reload(broken.transactionKey)).toMatchObject({ appuserSettlementAmount: null, fxStatus: FxStatus.MISSING });
      expect(await reload(healed.transactionKey)).toMatchObject({ appuserSettlementAmount: -90, fxStatus: FxStatus.EXACT });
    } finally {
      failing.accountKey = null;
    }
  });

  it('reports what it would change on a dry run, and writes nothing', async () => {
    const setup = await usdAccount({ appuserCurrencyBalance: 800, balance: 1000, fxStatus: FxStatus.EXACT });
    const row = await addRow(setup, { amount: -100, date: '2026-03-02', fxStatus: FxStatus.MISSING });
    await addRate(setup.em, setup.usd, setup.eur, '2026-03-02', 0.9);

    const result = await reconvertFx(db.em(), { dryRun: true, now: NOW });

    expect(result).toMatchObject({ accountsRebuilt: 1, accountsRevalued: 1, dryRun: true, transactionsReconverted: 1 });
    expect(await reload(row.transactionKey)).toMatchObject({ appuserSettlementAmount: null, fxStatus: FxStatus.MISSING });
    expect(await reloadAccount(setup)).toMatchObject({ appuserCurrencyBalance: 800 });
    expect(await db.em().count(TransactionAuditLog, {})).toBe(0);
  });
});

/*
 * When a household adds, changes or deletes an override, every stored amount of that household in
 * that pair is converted again at whatever the resolver now says, including back to the feed rate
 * or to `missing` once the override is gone. Nothing of another household moves.
 */
describe('re-converting a household pair after an override changes', () => {
  const db = useTestDatabase();
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
  const NOW = day('2026-03-10');

  interface Side {
    account: Account;
    household: Household;
  }

  async function world() {
    const em = db.em();
    const xof = await currencyFor(em, 'XOF');
    const usd = await currencyFor(em, 'USD');
    const home = await seedHousehold(em);
    const neighbour = await seedHousehold(em);
    const mine: Side = { account: await addAccount(em, home, { balance: 100_000, currency: xof, name: 'Francs' }), household: home };
    const theirs: Side = { account: await addAccount(em, neighbour, { balance: 100_000, currency: xof, name: 'Their francs' }), household: neighbour };
    return { em, eur: home.currency, home, mine, neighbour, theirs, usd, xof };
  }

  async function addRow(em: EntityManager, side: Side, input: { amount: number; appuserAmount?: null | number; date: string; fxStatus: FxStatus | null; rate?: number }): Promise<Transaction> {
    const row = em.create(Transaction, {
      accountKey: side.account,
      appuserCurrencyExchangeRate: input.rate,
      appuserCurrencyKey: side.household.currency,
      appuserKey: side.household.appuser,
      appuserSettlementAmount: input.appuserAmount ?? null,
      fxStatus: input.fxStatus,
      settlementAmount: input.amount,
      settlementCurrencyKey: side.account.currencyKey,
      tenantKey: side.household.tenant,
      transactionDate: day(input.date),
      transactionStatusKey: side.household.statuses.BOOKED,
      transactionTypeKey: side.household.types.cardPayment,
    }, { partial: true });
    await em.flush();
    return row;
  }

  async function setOverride(em: EntityManager, household: Household, from: Currency, to: Currency, date: string, rate: number) {
    const override = em.create(ExchangeRateOverride, { date: day(date), fromCurrency: from, rate, tenantKey: household.tenant, toCurrency: to }, { partial: true });
    await em.flush();
    return override;
  }

  async function addRate(em: EntityManager, from: Currency, to: Currency, date: string, rate: number) {
    em.create(ExchangeRate, { date: day(date), fromCurrency: from, rate, toCurrency: to }, { partial: true });
    await em.flush();
  }

  const reload = (key: number) => db.em().findOneOrFail(Transaction, { transactionKey: key }, { filters: false });
  const reloadAccount = (account: Account) => db.em().findOneOrFail(Account, { accountKey: account.accountKey }, { filters: false });
  const pairOf = (household: Household, from: string, to = 'EUR') => ({ fromCurrency: from, tenantKey: household.tenant.tenantKey, toCurrency: to });

  it('converts the household rows and balance of a pair the feed does not cover', async () => {
    const { em, eur, home, mine, xof } = await world();
    const row = await addRow(em, mine, { amount: -10_000, date: '2026-03-04', fxStatus: FxStatus.MISSING });
    await setOverride(em, home, xof, eur, '2026-03-02', 0.0015);

    const result = await reconvertFxForOverride(db.em(), pairOf(home, 'XOF'), { now: NOW });

    expect(await reload(row.transactionKey)).toMatchObject({ appuserCurrencyExchangeRate: 0.0015, appuserSettlementAmount: -15, fxStatus: FxStatus.EXACT });
    expect(await reloadAccount(mine.account)).toMatchObject({ appuserCurrencyBalance: 150, fxStatus: FxStatus.PROVISIONAL });
    expect(result).toMatchObject({ accountsRebuilt: 1, accountsRevalued: 1, transactionsReconverted: 1 });
  });

  it('leaves another household with the same pair untouched', async () => {
    const { em, eur, home, mine, theirs, xof } = await world();
    await addRow(em, mine, { amount: -10_000, date: '2026-03-04', fxStatus: FxStatus.MISSING });
    const theirRow = await addRow(em, theirs, { amount: -10_000, date: '2026-03-04', fxStatus: FxStatus.MISSING });
    await setOverride(em, home, xof, eur, '2026-03-02', 0.0015);

    await reconvertFxForOverride(db.em(), pairOf(home, 'XOF'), { now: NOW });
    // The global pass, too, converts each household with its own overrides only.
    await reconvertFx(db.em(), { now: NOW });

    expect(await reload(theirRow.transactionKey)).toMatchObject({ appuserSettlementAmount: null, fxStatus: FxStatus.MISSING });
    expect(await reloadAccount(theirs.account)).toMatchObject({ appuserCurrencyBalance: null });
    expect(await db.em().count(TransactionAuditLog, { tenantKey: { tenantKey: theirs.household.tenant.tenantKey } })).toBe(0);
  });

  it('rewrites rows converted at the feed rate on the override day, and only those', async () => {
    const { em, eur, home, usd } = await world();
    const dollars: Side = { account: await addAccount(em, home, { appuserCurrencyBalance: 900, balance: 1000, currency: usd, name: 'Dollars' }), household: home };
    await addRate(em, usd, eur, '2026-03-02', 0.9);
    await addRate(em, usd, eur, '2026-03-03', 0.91);
    const onTheDay = await addRow(em, dollars, { amount: -100, appuserAmount: -90, date: '2026-03-02', fxStatus: FxStatus.EXACT, rate: 0.9 });
    const dayAfter = await addRow(em, dollars, { amount: -100, appuserAmount: -91, date: '2026-03-03', fxStatus: FxStatus.EXACT, rate: 0.91 });
    await setOverride(em, home, usd, eur, '2026-03-02', 0.95);

    const result = await reconvertFxForOverride(db.em(), pairOf(home, 'USD'), { now: NOW });

    expect(await reload(onTheDay.transactionKey)).toMatchObject({ appuserCurrencyExchangeRate: 0.95, appuserSettlementAmount: -95, fxStatus: FxStatus.EXACT });
    expect(await reload(dayAfter.transactionKey)).toMatchObject({ appuserCurrencyExchangeRate: 0.91, appuserSettlementAmount: -91 });
    expect(result.transactionsReconverted).toBe(1);
  });

  it('falls back to the feed rate, or to missing, once the override is deleted', async () => {
    const { em, eur, home, mine, usd, xof } = await world();
    const dollars: Side = { account: await addAccount(em, home, { balance: 1000, currency: usd, name: 'Dollars' }), household: home };
    await addRate(em, usd, eur, '2026-03-02', 0.9);
    const franc = await addRow(em, mine, { amount: -10_000, date: '2026-03-04', fxStatus: FxStatus.MISSING });
    const dollar = await addRow(em, dollars, { amount: -100, date: '2026-03-02', fxStatus: FxStatus.MISSING });
    const xofOverride = await setOverride(em, home, xof, eur, '2026-03-02', 0.0015);
    const usdOverride = await setOverride(em, home, usd, eur, '2026-03-02', 0.95);
    await reconvertFxForOverride(db.em(), pairOf(home, 'XOF'), { now: NOW });
    await reconvertFxForOverride(db.em(), pairOf(home, 'USD'), { now: NOW });
    expect(await reload(dollar.transactionKey)).toMatchObject({ appuserSettlementAmount: -95 });

    for (const override of [xofOverride, usdOverride]) override.deletedAt = new Date();
    await em.flush();
    await reconvertFxForOverride(db.em(), pairOf(home, 'XOF'), { now: NOW });
    await reconvertFxForOverride(db.em(), pairOf(home, 'USD'), { now: NOW });

    expect(await reload(franc.transactionKey)).toMatchObject({ appuserCurrencyExchangeRate: null, appuserSettlementAmount: null, fxStatus: FxStatus.MISSING });
    expect(await reloadAccount(mine.account)).toMatchObject({ appuserCurrencyBalance: null, fxStatus: FxStatus.MISSING });
    expect(await reload(dollar.transactionKey)).toMatchObject({ appuserCurrencyExchangeRate: 0.9, appuserSettlementAmount: -90, fxStatus: FxStatus.EXACT });
  });

  it('records each change as a system edit from the override', async () => {
    const { em, eur, home, mine, xof } = await world();
    const row = await addRow(em, mine, { amount: -10_000, date: '2026-03-04', fxStatus: FxStatus.MISSING });
    await setOverride(em, home, xof, eur, '2026-03-02', 0.0015);

    await reconvertFxForOverride(db.em(), pairOf(home, 'XOF'), { now: NOW });

    const audits = await db.em().find(TransactionAuditLog, { transactionKey: { transactionKey: row.transactionKey } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ eventType: TransactionAuditEventType.SYSTEM_EDIT, source: 'fx-override' });
  });

  it('changes nothing when run a second time', async () => {
    const { em, eur, home, mine, xof } = await world();
    await addRow(em, mine, { amount: -10_000, date: '2026-03-04', fxStatus: FxStatus.MISSING });
    await addRow(em, mine, { amount: -5_000, appuserAmount: -5_000, date: '2026-03-05', fxStatus: null });
    await setOverride(em, home, xof, eur, '2026-03-02', 0.0015);
    await reconvertFxForOverride(db.em(), pairOf(home, 'XOF'), { now: NOW });
    const before = await db.em().find(Transaction, {}, { filters: false, orderBy: { transactionKey: 'asc' } });
    const auditsBefore = await db.em().count(TransactionAuditLog, {});

    const second = await reconvertFxForOverride(db.em(), pairOf(home, 'XOF'), { now: NOW });

    const after = await db.em().find(Transaction, {}, { filters: false, orderBy: { transactionKey: 'asc' } });
    expect(second).toMatchObject({ accountsRebuilt: 0, accountsRevalued: 0, transactionsReconverted: 0 });
    expect(after.map(snapshot)).toEqual(before.map(snapshot));
    expect(await db.em().count(TransactionAuditLog, {})).toBe(auditsBefore);
  });

  it('leaves rows in other currencies alone', async () => {
    const { em, eur, home, usd, xof } = await world();
    const dollars: Side = { account: await addAccount(em, home, { balance: 1000, currency: usd, name: 'Dollars' }), household: home };
    const dollar = await addRow(em, dollars, { amount: -100, appuserAmount: -100, date: '2026-03-04', fxStatus: null });
    await setOverride(em, home, xof, eur, '2026-03-02', 0.0015);

    const result = await reconvertFxForOverride(db.em(), pairOf(home, 'XOF'), { now: NOW });

    expect(await reload(dollar.transactionKey)).toMatchObject({ appuserSettlementAmount: -100, fxStatus: null });
    expect(result.accountsScanned).toBe(1);
  });
});

function snapshot(row: Transaction) {
  return {
    appuserCurrencyBalance: row.appuserCurrencyBalance,
    appuserCurrencyExchangeRate: row.appuserCurrencyExchangeRate,
    appuserSettlementAmount: row.appuserSettlementAmount,
    balance: row.balance,
    fxStatus: row.fxStatus,
    transactionKey: row.transactionKey,
  };
}
