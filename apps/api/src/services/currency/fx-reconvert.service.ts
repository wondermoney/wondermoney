/**
 * Heal amounts stored without a usable rate, and keep foreign-currency account balances on the
 * latest rate.
 *
 * Every writer converts through the one resolver (`exchange-rate.ts`). When it had no rate, or only
 * a stale one, the row says so (`fxStatus` `missing` / `provisional`), and rows written before
 * `fxStatus` existed may hold a 1:1 fallback: a foreign settlement currency, no stored rate and no
 * status. This pass converts those rows again once a better rate is stored, revalues every account
 * whose currency differs from its owner's at the latest rate, and rebuilds the running balance of
 * each account it changed.
 *
 * Rules, so a run can be repeated at will:
 * - A row only moves up: `missing` (or unstamped) → `provisional` → `exact`, or a provisional row
 *   to a newer provisional rate. It never loses a stored amount for want of a rate.
 * - An account balance is revalued at the latest rate on or before `now`. With no rate it keeps
 *   what it has.
 * - Each account is handled in its own database transaction, under a row lock on the account, so
 *   a concurrent edit or sync of that account waits and every account commits whole.
 *
 * Tenant safety: it runs without a tenant context (the system bypass of the tenant filter), but it
 * only ever works on one account at a time and converts each row to the currency already stored on
 * it, and each account to its own owner's currency, with the rates of the account's own household
 * (the feed's plus that household's overrides). Nothing is read across accounts.
 *
 * {@link reconvertFxForOverride} is the pass run after a household adds, changes or deletes an
 * override: it converts every row and balance of that household in that one pair again at whatever
 * the resolver now says, so it may also move a row back to the feed rate or to `missing`.
 */
import { LockMode } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { sql } from 'kysely';

import { HIDDEN_FILTER } from '@app/database/filters/tenant-filter';
import { sqlQuery } from '@app/database/sql';
import { Account } from '@entity/Account';
import { FxStatus, Transaction } from '@entity/Transaction';
import { TransactionAuditActorType, TransactionAuditEventType } from '@entity/TransactionAuditLog';
import { conversionAt, convertWithStatus, type FxConversion, loadRateTable, type RateScope, rateScope } from '@service/currency/exchange-rate';
import { recalculateChainFromAccountBalance } from '@service/transaction/balance-chain.service';
import { TransactionAuditService } from '@service/transaction/transaction-audit.service';
import logger from '@utils/logger';

export const FX_RECONVERT_AUDIT_SOURCE = 'fx-reconvert';
export const FX_OVERRIDE_AUDIT_SOURCE = 'fx-override';

/** One household's currency pair, by currency code: what an override change can affect. */
export interface FxOverridePair {
  fromCurrency: string;
  tenantKey: number;
  toCurrency: string;
}

export interface FxReconvertOptions {
  /** Work out every change, report it, and roll it all back. */
  dryRun?: boolean;
  /** The date account balances are revalued at. Defaults to now. */
  now?: Date;
}

export interface FxReconvertResult {
  /** Accounts whose pass threw and was rolled back; the next run tries them again. */
  accountsFailed: number;
  /** Accounts whose running balance was rebuilt because a row or the balance changed. */
  accountsRebuilt: number;
  /** Accounts looked at: every foreign-currency account plus every account with a row to retry. */
  accountsRevalued: number;
  accountsScanned: number;
  dryRun: boolean;
  transactionsReconverted: number;
  /** Rows that were candidates for re-conversion. */
  transactionsScanned: number;
}

interface AccountOutcome {
  rebuilt: boolean;
  reconverted: number;
  revalued: boolean;
  scanned: number;
}

class DryRunRollback extends Error {
  constructor(readonly outcome: AccountOutcome) {
    super('fx-reconvert dry run');
  }
}

export async function reconvertFx(em: EntityManager, options: FxReconvertOptions = {}): Promise<FxReconvertResult> {
  const now = options.now ?? new Date();
  return runPerAccount(em, await findAccountsToCheck(em), options, (tx, accountKey) => reconvertAccount(tx, accountKey, now));
}

/**
 * Convert every stored amount of one household in one pair again, after an override of that pair
 * changed: each row whose settlement currency is `fromCurrency` and user currency `toCurrency`, and
 * each account in `fromCurrency` owned by a member whose currency is `toCurrency`. Unlike
 * {@link reconvertFx} it takes whatever the resolver now answers, so deleting an override moves a
 * row back to the feed rate, or to `missing` when the feed has none. Rows it would not change are
 * not written, so a second run changes nothing.
 */
export async function reconvertFxForOverride(em: EntityManager, pair: FxOverridePair, options: FxReconvertOptions = {}): Promise<FxReconvertResult> {
  const now = options.now ?? new Date();
  if (pair.fromCurrency === pair.toCurrency) return emptyResult(options.dryRun ?? false, 0);
  return runPerAccount(em, await findHouseholdAccountsInPair(em, pair), options, (tx, accountKey) => reconvertAccountPair(tx, accountKey, pair, now));
}

function emptyResult(dryRun: boolean, accountsScanned: number): FxReconvertResult {
  return { accountsFailed: 0, accountsRebuilt: 0, accountsRevalued: 0, accountsScanned, dryRun, transactionsReconverted: 0, transactionsScanned: 0 };
}

async function reconvertAccount(em: EntityManager, accountKey: number, now: Date): Promise<AccountOutcome> {
  const outcome: AccountOutcome = { rebuilt: false, reconverted: 0, revalued: false, scanned: 0 };
  const account = await em.findOne(Account, { accountKey, deletedAt: null }, { filters: false, lockMode: LockMode.PESSIMISTIC_WRITE });
  if (!account) return outcome;
  await em.populate(account, ['currencyKey', 'accountOwnerAppuserKey.currencyKey'], { filters: false });

  const scope = rateScope(account.tenantKey);
  outcome.revalued = await revalueAccount(em, account, now, scope);

  const rows = await reconvertAccountRows(em, account);
  outcome.scanned = rows.scanned;
  outcome.reconverted = rows.reconverted;

  if (outcome.revalued || outcome.reconverted > 0) {
    await recalculateChainFromAccountBalance(em, account);
    outcome.rebuilt = true;
  }
  await em.flush();
  return outcome;
}

async function runForAccount(em: EntityManager, accountKey: number, dryRun: boolean, pass: (tx: EntityManager, accountKey: number) => Promise<AccountOutcome>): Promise<AccountOutcome> {
  try {
    return await em.transactional(async (tx) => {
      const outcome = await pass(tx, accountKey);
      if (dryRun) throw new DryRunRollback(outcome);
      return outcome;
    });
  } catch (error) {
    if (error instanceof DryRunRollback) return error.outcome;
    throw error;
  }
}

async function runPerAccount(em: EntityManager, accountKeys: number[], options: FxReconvertOptions, pass: (tx: EntityManager, accountKey: number) => Promise<AccountOutcome>): Promise<FxReconvertResult> {
  const dryRun = options.dryRun ?? false;
  const result = emptyResult(dryRun, accountKeys.length);

  for (const accountKey of accountKeys) {
    let outcome: AccountOutcome;
    try {
      // A fresh identity map per account keeps memory flat over a large backfill.
      outcome = await runForAccount(em.fork(), accountKey, dryRun, pass);
    } catch (error) {
      // One account's failure rolls back that account only; the rest still catch up.
      result.accountsFailed += 1;
      logger.error({ accountKey, error }, 'fx.reconvert failed for an account');
      continue;
    }
    result.transactionsScanned += outcome.scanned;
    result.transactionsReconverted += outcome.reconverted;
    if (outcome.revalued) result.accountsRevalued += 1;
    if (outcome.rebuilt) result.accountsRebuilt += 1;
  }

  return result;
}

/**
 * Convert again every row on `account` stored without a usable rate, where a better one now exists
 * (see {@link isUpgrade}), at the rates of the account's own household, auditing each change as a
 * system edit from `source`. Writes nothing to the database itself: the caller flushes, inside the
 * transaction that holds the account's lock, and rebuilds the running balance. Shared with the
 * account recalculation (`account-recalculation.service.ts`).
 */
export async function reconvertAccountRows(em: EntityManager, account: Account, source: string = FX_RECONVERT_AUDIT_SOURCE): Promise<{ reconverted: number; scanned: number }> {
  const scope = rateScope(account.tenantKey);
  const loaded = await em.find(Transaction, { accountKey: account, transactionDate: { $ne: null }, ...RETRY_WHERE }, {
    // Hidden and soft-deleted rows are running-balance members too, so they are healed as well.
    filters: { [HIDDEN_FILTER]: false },
    orderBy: { transactionKey: 'asc' },
    populate: ['settlementCurrencyKey', 'appuserCurrencyKey'],
  });
  const candidates = loaded.filter(isRetryCandidate);
  let reconverted = 0;
  for (const row of candidates) {
    if (await reconvertRow(em, account, row, scope, source)) reconverted += 1;
  }
  return { reconverted, scanned: candidates.length };
}

/** Convert a retry candidate again; true when it was upgraded. */
async function reconvertRow(em: EntityManager, account: Account, row: Transaction, scope: RateScope, source: string): Promise<boolean> {
  if (row.settlementAmount == null || !row.settlementCurrencyKey || !row.appuserCurrencyKey || !row.transactionDate) return false;
  const converted = await convertWithStatus(em, row.settlementAmount, row.settlementCurrencyKey, row.appuserCurrencyKey, row.transactionDate, scope);
  if (!isUpgrade(row, converted)) return false;
  await writeConversion(em, account, row, converted, source);
  return true;
}

/** Store `converted` on `row`, recorded as a system edit. */
async function writeConversion(em: EntityManager, account: Account, row: Transaction, converted: FxConversion, source: string): Promise<void> {
  const changes = {
    appuserCurrencyExchangeRate: { from: row.appuserCurrencyExchangeRate ?? null, to: converted.rate },
    appuserSettlementAmount: { from: row.appuserSettlementAmount ?? null, to: converted.amount },
    fxStatus: { from: row.fxStatus ?? null, to: converted.fxStatus },
  };
  row.appuserSettlementAmount = converted.amount;
  row.appuserCurrencyExchangeRate = converted.rate ?? undefined;
  row.fxStatus = converted.fxStatus;

  const appuserKey = keyOf(row.appuserKey) ?? keyOf(account.accountOwnerAppuserKey);
  const tenantKey = keyOf(row.tenantKey) ?? keyOf(account.tenantKey);
  if (appuserKey != null && tenantKey != null) {
    await TransactionAuditService.log(em, {
      accountKey: account.accountKey,
      actorType: TransactionAuditActorType.SYSTEM,
      appuserKey,
      changes,
      eventType: TransactionAuditEventType.SYSTEM_EDIT,
      source,
      tenantKey,
      transactionKey: row.transactionKey,
    }, { flush: false });
  }
}

/** The account balance in its owner's currency at the latest rate. False when nothing changed. */
async function revalueAccount(em: EntityManager, account: Account, now: Date, scope: RateScope): Promise<boolean> {
  const ownerCurrency = account.accountOwnerAppuserKey?.currencyKey;
  if (account.balance == null || !ownerCurrency || account.currencyKey.currencyKey === ownerCurrency.currencyKey) return false;
  const converted = await convertWithStatus(em, account.balance, account.currencyKey, ownerCurrency, now, scope);
  if (converted.amount == null) return false;
  if (converted.amount === account.appuserCurrencyBalance && converted.fxStatus === account.fxStatus) return false;
  account.appuserCurrencyBalance = converted.amount;
  account.fxStatus = converted.fxStatus;
  return true;
}

/**
 * One account's part of {@link reconvertFxForOverride}, under a row lock on the account. The account
 * must belong to the household: the pair's tenant is checked here, not only in the query that
 * found it.
 */
async function reconvertAccountPair(em: EntityManager, accountKey: number, pair: FxOverridePair, now: Date): Promise<AccountOutcome> {
  const outcome: AccountOutcome = { rebuilt: false, reconverted: 0, revalued: false, scanned: 0 };
  const account = await em.findOne(Account, { accountKey, deletedAt: null, tenantKey: { tenantKey: pair.tenantKey } }, { filters: false, lockMode: LockMode.PESSIMISTIC_WRITE });
  if (!account) return outcome;
  await em.populate(account, ['currencyKey', 'accountOwnerAppuserKey.currencyKey'], { filters: false });
  const scope = rateScope(pair.tenantKey);

  if (account.currencyKey.code === pair.fromCurrency && account.accountOwnerAppuserKey?.currencyKey.code === pair.toCurrency && account.balance != null) {
    const converted = await convertWithStatus(em, account.balance, account.currencyKey, account.accountOwnerAppuserKey.currencyKey, now, scope);
    if (converted.amount !== (account.appuserCurrencyBalance ?? null) || converted.fxStatus !== account.fxStatus) {
      account.appuserCurrencyBalance = converted.amount;
      account.fxStatus = converted.fxStatus;
      outcome.revalued = true;
    }
  }

  const rows = await em.find(Transaction, {
    accountKey: account,
    appuserCurrencyKey: { code: pair.toCurrency },
    settlementCurrencyKey: { code: pair.fromCurrency },
    tenantKey: { tenantKey: pair.tenantKey },
    transactionDate: { $ne: null },
  }, {
    // Hidden and soft-deleted rows are running-balance members too.
    filters: { [HIDDEN_FILTER]: false },
    orderBy: { transactionKey: 'asc' },
  });
  outcome.scanned = rows.length;
  const dated = rows.flatMap((row) => (row.transactionDate && row.settlementAmount != null ? [{ date: row.transactionDate, row, settlementAmount: row.settlementAmount }] : []));
  if (dated.length > 0) {
    const times = dated.map(({ date }) => date.getTime());
    const rates = await loadRateTable(em, [{ from: pair.fromCurrency, to: pair.toCurrency }], { from: new Date(Math.min(...times)), to: new Date(Math.max(...times)) }, scope);
    for (const { date, row, settlementAmount } of dated) {
      const converted = conversionAt(settlementAmount, rates.resolve(pair.fromCurrency, pair.toCurrency, date));
      if (sameConversion(row, converted)) continue;
      await writeConversion(em, account, row, converted, FX_OVERRIDE_AUDIT_SOURCE);
      outcome.reconverted += 1;
    }
  }

  if (outcome.revalued || outcome.reconverted > 0) {
    await recalculateChainFromAccountBalance(em, account);
    outcome.rebuilt = true;
  }
  await em.flush();
  return outcome;
}

function sameConversion(row: Pick<Transaction, 'appuserCurrencyExchangeRate' | 'appuserSettlementAmount' | 'fxStatus'>, next: FxConversion): boolean {
  return (row.appuserSettlementAmount ?? null) === next.amount && (row.appuserCurrencyExchangeRate ?? null) === next.rate && (row.fxStatus ?? null) === next.fxStatus;
}

const STATUS_RANK: Record<FxStatus, number> = { [FxStatus.EXACT]: 2, [FxStatus.MISSING]: 0, [FxStatus.PROVISIONAL]: 1 };

/**
 * Whether `next` is a better conversion than the one stored on `row`. An unstamped (legacy) row
 * ranks with `missing`: its amount may be a 1:1 fallback, so any real rate beats it.
 */
export function isUpgrade(row: Pick<Transaction, 'appuserCurrencyExchangeRate' | 'fxStatus'>, next: FxConversion): boolean {
  if (next.amount == null || next.fxStatus === FxStatus.MISSING) return false;
  const current = row.fxStatus == null ? STATUS_RANK[FxStatus.MISSING] : STATUS_RANK[row.fxStatus];
  const proposed = STATUS_RANK[next.fxStatus];
  if (proposed !== current) return proposed > current;
  // Two provisional rates: the resolver always takes the latest on or before the date, and stored
  // rates are never rewritten, so a different rate is a newer one.
  return next.fxStatus === FxStatus.PROVISIONAL && next.rate !== (row.appuserCurrencyExchangeRate ?? null);
}

/**
 * Rows worth converting again: stored as `missing` or `provisional`, or written before `fxStatus`
 * existed in a currency other than the user's with no stored rate (the old 1:1 fallback).
 */
const RETRY_WHERE = {
  $or: [
    { fxStatus: { $in: [FxStatus.MISSING, FxStatus.PROVISIONAL] } },
    { appuserCurrencyExchangeRate: null, fxStatus: null },
  ],
};

/** The part of the rule the ORM query cannot say: an unstamped row only counts in a foreign currency. */
function isRetryCandidate(row: Transaction): boolean {
  if (row.fxStatus != null) return true;
  return row.settlementCurrencyKey != null && row.appuserCurrencyKey != null && row.settlementCurrencyKey.currencyKey !== row.appuserCurrencyKey.currencyKey;
}

/**
 * Every account that may need work: each one in a currency other than its owner's (to revalue), and
 * each one holding a row to retry. Soft-deleted accounts are left alone.
 */
async function findAccountsToCheck(em: EntityManager): Promise<number[]> {
  const db = sqlQuery(em);
  const foreign = db
    .selectFrom('account as a')
    .innerJoin('appuser as u', 'u.appuser_key', 'a.account_owner_appuser_key')
    .select('a.account_key')
    .where('a.deleted_at', 'is', null)
    .whereRef('a.currency_key', '<>', 'u.currency_key');
  const withRows = db
    .selectFrom('transaction as t')
    .innerJoin('account as a', 'a.account_key', 't.account_key')
    .select('a.account_key')
    .where('a.deleted_at', 'is', null)
    .where('t.transaction_date', 'is not', null)
    .where(sql<boolean>`(t.fx_status in ('missing', 'provisional') or (t.fx_status is null and t.appuser_currency_exchange_rate is null and t.settlement_currency_key <> t.appuser_currency_key))`);
  const rows = await foreign.union(withRows).execute();
  return rows.map((row) => Number(row.account_key)).sort((a, b) => a - b);
}

/** The household's live accounts that hold a row in the pair, or are in `fromCurrency` with an owner in `toCurrency`. */
async function findHouseholdAccountsInPair(em: EntityManager, pair: FxOverridePair): Promise<number[]> {
  const db = sqlQuery(em);
  // Raw SQL bypasses the tenant filter: the household predicate is explicit on every table.
  const balances = db
    .selectFrom('account as a')
    .innerJoin('appuser as u', 'u.appuser_key', 'a.account_owner_appuser_key')
    .innerJoin('currency as ac', 'ac.currency_key', 'a.currency_key')
    .innerJoin('currency as uc', 'uc.currency_key', 'u.currency_key')
    .select('a.account_key')
    .where('a.deleted_at', 'is', null)
    .where('a.tenant_key', '=', pair.tenantKey)
    .where('ac.code', '=', pair.fromCurrency)
    .where('uc.code', '=', pair.toCurrency);
  const withRows = db
    .selectFrom('transaction as t')
    .innerJoin('account as a', 'a.account_key', 't.account_key')
    .innerJoin('currency as sc', 'sc.currency_key', 't.settlement_currency_key')
    .innerJoin('currency as pc', 'pc.currency_key', 't.appuser_currency_key')
    .select('a.account_key')
    .where('a.deleted_at', 'is', null)
    .where('a.tenant_key', '=', pair.tenantKey)
    .where('t.tenant_key', '=', pair.tenantKey)
    .where('t.transaction_date', 'is not', null)
    .where('sc.code', '=', pair.fromCurrency)
    .where('pc.code', '=', pair.toCurrency);
  const rows = await balances.union(withRows).execute();
  return rows.map((row) => Number(row.account_key)).sort((a, b) => a - b);
}

function keyOf(ref: undefined | { appuserKey: number } | { tenantKey: number }): number | undefined {
  if (!ref) return undefined;
  return 'appuserKey' in ref ? ref.appuserKey : ref.tenantKey;
}
