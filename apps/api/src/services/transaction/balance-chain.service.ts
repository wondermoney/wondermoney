/**
 * The account running-balance chain, in one place.
 *
 * `transaction.balance` is a *stored running total*, not a per-row fact the provider hands us. It
 * only means anything if every writer maintains the same invariant, over the same total order, over
 * the same set of rows:
 *
 *     row[1].balance = opening + row[1].settlementAmount
 *     row[n].balance = row[n-1].balance + row[n].settlementAmount
 *
 * There are three writers — manual creation (`transaction-creation.service.ts`), CSV import
 * (`account-csv-balance-recalculation.service.ts`) and bank sync
 * (`account-initial-sync-transaction.service.ts`) — and all of them take membership, order and
 * accumulation from here. A writer with its own model (a different tie-break, or a batch that
 * back-derives its own opening as though it were a contiguous suffix of history) breaks links.
 *
 * ORDER. `(transactionDate ASC, transactionKey ASC)` — the exact reverse of the order the
 * transactions list endpoint renders (`transactions.ts`), so the number in the row above a row in
 * the UI is the number its balance was accumulated from. `transactionKey` is the tie-break because
 * it is the only total order available on same-date rows.
 *
 * MEMBERSHIP. Every *settled* row on the account, hidden rows included (hiding a row from the UI
 * does not mean the money did not move) and soft-deleted rows included (the chain queries filter
 * on nothing but `accountKey` and `transactionDate`). Excluded:
 *   - rows with a NULL `transactionDate` — they have no position in the order;
 *   - PENDING and EXPIRED rows — a pending authorisation has not settled and an expired one never
 *     will, so neither moved money. They carry `balance = null` and are not chain members, so
 *     their nulls never count as a link that "diverges".
 * Manual and CSV accounts only ever hold BOOKED rows, so the settled restriction is a no-op there
 * and the three writers share one definition.
 *
 * ANCHOR. A whole-account recomputation has to be anchored on a value that survived:
 *   - manual / CSV accounts anchor at the *head*: `account.openingBalance` is the balance before
 *     the oldest row (typed when the account was created, moved by a CSV import that back-derives
 *     older rows), transactions accumulate on top of it, and `account.balance` is the chain tail —
 *     a derived value. An account with no stored opening balance falls back to the tail.
 *   - bank-synced accounts anchor at the *tail*: the provider is the source of truth for
 *     `account.balance`, so the chain is rebuilt backwards from it and `account.balance` is never
 *     overwritten. This is what makes the newest row's balance equal the figure on the accounts list.
 *
 * The tail anchor has a known cost, stated here so it is a choice and not an accident: if the
 * provider balance moves for a reason that is not a booked row (a pending authorisation clearing
 * against an `expected` balance, say), the whole chain shifts by that amount on the next sync.
 * Every row stays mutually consistent and the top row still matches the accounts list, but a
 * historical row's displayed balance can change between two views. The alternative — anchoring at
 * the head — keeps history fixed and instead lets `account.balance` disagree with the tail, which
 * is a user-visible defect. Tail wins because the accounts list and
 * the top of the transactions list are the two numbers a user actually compares.
 */

import { QueryOrder } from '@mikro-orm/core';

import { HIDDEN_FILTER } from '@app/database/filters/tenant-filter';
import type { Account } from '@entity/Account';
import { type FxStatus, Transaction } from '@entity/Transaction';
import { big, toNumber } from '@utils/money';

/**
 * Balances are `numeric(18, 4)` in Postgres but accumulated in JS floats, so stored values carry
 * float noise. Anything under half a hundredth of a cent is noise, not a change.
 */
const BALANCE_TOLERANCE = 0.005;

/**
 * Transaction statuses whose money has actually moved and therefore participate in the chain.
 * PENDING has not settled; EXPIRED never will.
 */
export const SETTLED_TRANSACTION_STATUSES = ['BOOKED'] as const;

/** The chain's total order. The transactions list renders its exact reverse. */
const CHAIN_ORDER_BY = {
  transactionDate: QueryOrder.ASC,
  transactionKey: QueryOrder.ASC,
} as const;

export interface ChainBalance {
  /** Null once a row in the chain has no amount in the user's currency (`FxStatus.MISSING`). */
  appuserCurrencyBalance: null | number;
  balance: number;
}

/**
 * A row to begin a suffix recomputation *at*. The row before the anchor supplies the opening
 * balance verbatim, so everything upstream of the anchor is left exactly as stored.
 */
export interface ChainAnchor {
  /**
   * The anchor row's amounts before the change. Needed when the anchor is the account's oldest
   * row: with no predecessor, the opening is its stored balance minus these.
   */
  previous?: Pick<ChainRow, 'appuserSettlementAmount' | 'settlementAmount'>;
  transactionKey: number;
}

/** Minimal surface of the row the accumulation needs, so the arithmetic is testable without MikroORM. */
export interface ChainRow {
  appuserCurrencyBalance?: null | number;
  appuserCurrencyKey?: { currencyKey: number };
  appuserSettlementAmount?: null | number;
  balance?: number;
  fxStatus?: FxStatus | null;
  settlementAmount?: number;
  settlementCurrencyKey?: { currencyKey: number };
}

/** The EntityManager surface these helpers need. Keeps the service mockable in unit tests. */
export interface ChainEntityManager {
  find<T>(entityClass: new (...args: never[]) => T, where: Record<string, unknown>, options?: Record<string, unknown>): Promise<T[]>;
  flush(): Promise<void>;
}

/** A row settled in the user's own currency, so its two amounts and balances are the same. */
function isInUserCurrency(row: ChainRow): boolean {
  return row.settlementCurrencyKey != null && row.settlementCurrencyKey.currencyKey === row.appuserCurrencyKey?.currencyKey;
}

/** Not linked to a bank: its balance is the chain tail, not a provider figure. */
function isManualAccount(account: Account): boolean {
  return account.enableBankingConnectionKey == null && account.nordigenRequisitionKey == null;
}

/** True when a row's settlement has actually happened, so it belongs in the chain. */
export function isSettledStatusName(name: string | undefined): boolean {
  return name !== undefined && (SETTLED_TRANSACTION_STATUSES as readonly string[]).includes(name);
}

/**
 * Walk `rows` in chain order, assigning each one the running balance, and return the tail.
 *
 * Pure and in-place: the single piece of arithmetic every writer shares. `opening` is the balance
 * *before* the first row, so an empty `rows` returns `opening` unchanged.
 */
export function accumulateChain(rows: ChainRow[], opening: ChainBalance): ChainBalance {
  // RAD-audit: this was float `+=` over the whole account history, run both forwards and
  // backwards on every sync, and the drift it produced was persisted. Exact decimal
  // accumulation, rounded to the column's own scale at each step so the stored chain is
  // reproducible: recomputing from the same rows yields byte-identical balances.
  let balance = big(opening.balance);
  // The user-currency balance stops being known at the first row with no converted amount, and
  // stays unknown to the tail: it is never carried on at the account currency's face value.
  let appuserCurrencyBalance = opening.appuserCurrencyBalance == null ? null : big(opening.appuserCurrencyBalance);

  for (const row of rows) {
    balance = balance.plus(big(row.settlementAmount));
    const appuserAmount = chainAppuserAmount(row);
    appuserCurrencyBalance = appuserCurrencyBalance == null || appuserAmount == null ? null : appuserCurrencyBalance.plus(big(appuserAmount));
    row.balance = toNumber(balance);
    row.appuserCurrencyBalance = appuserCurrencyBalance == null ? null : toNumber(appuserCurrencyBalance);
  }

  return { appuserCurrencyBalance: appuserCurrencyBalance == null ? null : toNumber(appuserCurrencyBalance), balance: toNumber(balance) };
}

/**
 * The amount a row adds to the user-currency balance, or null when it has none.
 *
 * A row with a status but no converted amount (`missing`) contributes nothing knowable. A row
 * with neither predates `fxStatus`; it keeps the settlement amount it has always contributed until
 * it is restamped.
 */
export function chainAppuserAmount(row: Pick<ChainRow, 'appuserSettlementAmount' | 'fxStatus' | 'settlementAmount'>): null | number | undefined {
  if (row.appuserSettlementAmount != null) return row.appuserSettlementAmount;
  if (row.fxStatus != null) return null;
  return row.settlementAmount;
}

/**
 * A stored row's user-currency balance as an opening. A stamped row with none means the balance is
 * unknown from there; an unstamped one keeps its old reading (`legacyReading`) until restamped.
 */
export function storedAppuserBalance(row: Pick<ChainRow, 'appuserCurrencyBalance' | 'fxStatus'>, legacyReading: null | number): null | number {
  if (row.appuserCurrencyBalance != null) return row.appuserCurrencyBalance;
  return row.fxStatus != null ? null : legacyReading;
}

/** An account's user-currency balance as a chain anchor; null when it has none. */
export function accountAppuserTail(account: Pick<Account, 'appuserCurrencyBalance' | 'balance' | 'fxStatus'>): null | number {
  if (account.appuserCurrencyBalance != null) return account.appuserCurrencyBalance;
  // The same rule as rows: an unstamped account keeps its old reading until it is restamped.
  if (account.fxStatus != null) return null;
  return account.balance ?? 0;
}

/** The opening balance implied by anchoring `rows` so that the last one lands on `tail`. */
export function openingFromTail(rows: ChainRow[], tail: ChainBalance): ChainBalance {
  let balance = big(tail.balance);
  let appuserCurrencyBalance = tail.appuserCurrencyBalance == null ? null : big(tail.appuserCurrencyBalance);

  for (const row of rows) {
    balance = balance.minus(big(row.settlementAmount));
    const appuserAmount = chainAppuserAmount(row);
    appuserCurrencyBalance = appuserCurrencyBalance == null || appuserAmount == null ? null : appuserCurrencyBalance.minus(big(appuserAmount));
  }

  return { appuserCurrencyBalance: appuserCurrencyBalance == null ? null : toNumber(appuserCurrencyBalance), balance: toNumber(balance) };
}

/**
 * Load every chain row on an account, in chain order.
 *
 * `extraWhere` narrows the *set* (the callers that only need a suffix pass a `transactionDate`
 * predicate); it must never widen it, and it must never reintroduce the hidden filter.
 */
export async function loadChainRows(
  em: ChainEntityManager,
  account: Account,
  extraWhere: Record<string, unknown> = {},
): Promise<Transaction[]> {
  return em.find(
    Transaction,
    {
      accountKey: account,
      transactionStatusKey: { name: { $in: [...SETTLED_TRANSACTION_STATUSES] } },
      ...extraWhere,
    },
    {
      // The chain is physical, so hidden rows count here too.
      filters: { [HIDDEN_FILTER]: false },
      orderBy: CHAIN_ORDER_BY,
    },
  );
}

/**
 * Rebuild a bank-synced account's whole chain, anchored on `account.balance`.
 *
 * `account.balance` has just been written from the provider (`account-initial-sync-account.service`
 * runs before the transaction phase in both sync workers), so it is the one trustworthy number on
 * the account and this deliberately does not touch it. Everything else is derived from it: the
 * opening balance falls out of the row amounts, and the tail lands back exactly on
 * `account.balance`.
 *
 * Whole-account rather than suffix-only on purpose. A sync batch can carry a row dated before rows
 * already stored (banks back-date, and the auto-sync window slides), so there is no suffix that is
 * guaranteed to contain every row whose balance changed.
 *
 * `anchor` narrows the recomputation to a suffix. When a caller knows a single row's amount changed
 * — an edit to a stored transaction — only that row and every row after it can have moved; rows
 * before it still hold the balance the *previous* row produced, so the anchor's preceding row is
 * taken as the opening balance verbatim and left untouched. When the anchor is the oldest row there
 * is no preceding row, so the opening is the anchor's own stored balance minus `anchor.previous`
 * (its pre-change amounts); without `previous` it falls back to the tail anchor. This is the head-anchored counterpart
 * to the tail anchor: history upstream of the edit is fixed rather than re-derived from
 * `account.balance`. The row set (settled, non-null date, hidden included) and the
 * `(transactionDate, transactionKey)` order are unchanged, so the suffix boundaries match a
 * whole-account run. An anchor whose row is not in the chain — a pending or undated row, say —
 * falls back to the whole-account rebuild.
 *
 * A whole-account rebuild of a manual account with a stored `openingBalance` anchors at the head
 * instead (see ANCHOR above): every row is re-accumulated from the opening balance, and the
 * returned tail is the account's corrected balance.
 *
 * Returns the new tail balance plus the number of rows whose stored balance actually moved. The
 * tail is what an edit-transaction caller needs to assign to `account.balance` after the chain has
 * been rewritten, since the helper does not touch the account row itself.
 */
export interface RecalculateChainResult {
  changed: number;
  tail: ChainBalance;
}

export async function recalculateChainFromAccountBalance(
  em: ChainEntityManager,
  account: Account,
  anchor?: ChainAnchor,
): Promise<RecalculateChainResult> {
  const rows = await loadChainRows(em, account, { transactionDate: { $ne: null } });
  if (rows.length === 0) return { changed: 0, tail: { appuserCurrencyBalance: 0, balance: 0 } };

  const anchorIndex = anchor === undefined ? -1 : rows.findIndex((row) => row.transactionKey === anchor.transactionKey);

  let startIndex = 0;
  let opening: ChainBalance;

  const anchorRow = anchorIndex >= 0 ? rows[anchorIndex] : undefined;
  const prior = anchorIndex > 0 ? rows[anchorIndex - 1] : undefined;

  if (prior) {
    // The anchor itself is the first row that can have changed; its predecessor's stored balance is
    // still correct, so it becomes the opening and every earlier row is never written.
    startIndex = anchorIndex;
    opening = {
      appuserCurrencyBalance: storedAppuserBalance(prior, prior.balance ?? 0),
      balance: prior.balance ?? 0,
    };
  } else if (anchorRow && anchor?.previous && anchorRow.balance != null) {
    // The oldest row has no predecessor: what the account held before it is its stored balance
    // minus its pre-change amount. Opening at 0 instead would replace the balance with the sum of
    // the rows.
    startIndex = anchorIndex;
    opening = openingFromTail([anchor.previous], {
      appuserCurrencyBalance: storedAppuserBalance(anchorRow, anchorRow.balance),
      balance: anchorRow.balance,
    });
  } else {
    const tail: ChainBalance = {
      appuserCurrencyBalance: accountAppuserTail(account),
      balance: account.balance ?? 0,
    };
    opening = openingFromTail(rows, tail);
    if (isManualAccount(account) && account.openingBalance != null) {
      // A manual account's balance is derived, so the opening balance is the one value to trust.
      // In the user's currency the chain opens on it too when the rows are in that currency;
      // otherwise there is no converted opening, and that side stays on the account balance.
      opening = {
        appuserCurrencyBalance: rows.every(isInUserCurrency) ? account.openingBalance : opening.appuserCurrencyBalance,
        balance: account.openingBalance,
      };
    }
  }

  const suffix = rows.slice(startIndex);
  const before = suffix.map((row) => row.balance);
  const tail = accumulateChain(suffix, opening);

  const changed = suffix.reduce((count, row, index) => {
    const previous = before[index];
    return previous === undefined || Math.abs(previous - (row.balance ?? 0)) > BALANCE_TOLERANCE ? count + 1 : count;
  }, 0);

  await em.flush();

  return { changed, tail };
}
