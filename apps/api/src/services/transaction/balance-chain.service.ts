/**
 * RAD-564 — the account running-balance chain, in one place.
 *
 * `transaction.balance` is a *stored running total*, not a per-row fact the provider hands us. It
 * only means anything if every writer maintains the same invariant, over the same total order, over
 * the same set of rows:
 *
 *     row[1].balance = opening + row[1].settlementAmount
 *     row[n].balance = row[n-1].balance + row[n].settlementAmount
 *
 * Before RAD-564 there were three writers with three different models — manual creation
 * (`transaction-creation.service.ts`, chain, ordered `(transactionDate, transactionKey)`), CSV
 * import (`account-csv-balance-recalculation.service.ts`, chain, ordered
 * `(transactionDate, settlementAmount, transactionKey)`) and bank sync
 * (`account-initial-sync-transaction.service.ts`, *no* chain: each import batch back-derived its own
 * opening from `account.balance` and assigned balances as though the batch were a contiguous suffix
 * of history). On production that left 51.6% of the links on bank-synced accounts broken.
 *
 * ORDER. `(transactionDate ASC, transactionKey ASC)` — the exact reverse of the order the
 * transactions list endpoint renders (`transactions.ts`), so the number in the row above a row in
 * the UI is the number its balance was accumulated from. `transactionKey` is the tie-break because
 * it is the only total order available on same-date rows (RAD-546).
 *
 * MEMBERSHIP. Every *settled* row on the account, hidden rows included (RAD-25 — hiding a row from
 * the UI does not mean the money did not move) and soft-deleted rows included (matching RAD-546 and
 * the RAD-554 sizing query, whose chain queries filter on nothing but `accountKey` and
 * `transactionDate`). Excluded:
 *   - rows with a NULL `transactionDate` — they have no position in the order;
 *   - PENDING and EXPIRED rows — a pending authorisation has not settled and an expired one never
 *     will, so neither moved money. They carry `balance = null`, which is what they already carry
 *     today; RAD-564 stops treating those nulls as chain members that "diverge".
 * Manual and CSV accounts only ever hold BOOKED rows, so the settled restriction is a no-op there
 * and the three writers now share one definition.
 *
 * ANCHOR. There is no stored opening-balance column (see the RAD-554 docblock), so a whole-account
 * recomputation has to be anchored on a value that survived:
 *   - manual / CSV accounts anchor at the *head*: the user typed an opening balance, transactions
 *     accumulate on top of it, and `account.balance` is the chain tail — a derived value.
 *   - bank-synced accounts anchor at the *tail*: the provider is the source of truth for
 *     `account.balance`, so the chain is rebuilt backwards from it and `account.balance` is never
 *     overwritten. This is RAD-554's `preserve-account-balance` strategy applied as a forward-going
 *     rule, and it is what makes the newest row's balance equal the figure on the accounts list.
 *
 * The tail anchor has a known cost, stated here so it is a choice and not an accident: if the
 * provider balance moves for a reason that is not a booked row (a pending authorisation clearing
 * against an `expected` balance, say), the whole chain shifts by that amount on the next sync.
 * Every row stays mutually consistent and the top row still matches the accounts list, but a
 * historical row's displayed balance can change between two views. The alternative — anchoring at
 * the head — keeps history fixed and instead lets `account.balance` disagree with the tail, which
 * is the user-visible defect this ticket also had to fix. Tail wins because the accounts list and
 * the top of the transactions list are the two numbers a user actually compares.
 */

import { QueryOrder } from '@mikro-orm/core';

import { HIDDEN_FILTER } from '@app/database/filters/tenant-filter';
import type { Account } from '@entity/Account';
import { Transaction } from '@entity/Transaction';
import { big, toNumber } from '@utils/money';

/**
 * Balances are `numeric(18, 4)` in Postgres but accumulated in JS floats, so stored values carry
 * float noise. Anything under half a hundredth of a cent is noise, not a change (matches
 * `rad554-balance-chain.ts`).
 */
export const BALANCE_TOLERANCE = 0.005;

/**
 * Transaction statuses whose money has actually moved and therefore participate in the chain.
 * PENDING has not settled; EXPIRED (RAD-346) never will.
 */
export const SETTLED_TRANSACTION_STATUSES = ['BOOKED'] as const;

/** The chain's total order. The transactions list renders its exact reverse. */
export const CHAIN_ORDER_BY = {
  transactionDate: QueryOrder.ASC,
  transactionKey: QueryOrder.ASC,
} as const;

export interface ChainBalance {
  appuserCurrencyBalance: number;
  balance: number;
}

/**
 * A row to begin a suffix recomputation *at*. The row before the anchor supplies the opening
 * balance verbatim, so everything upstream of the anchor is left exactly as stored.
 */
export interface ChainAnchor {
  transactionKey: number;
}

/** Minimal surface of the row the accumulation needs, so the arithmetic is testable without MikroORM. */
export interface ChainRow {
  appuserCurrencyBalance?: number;
  appuserSettlementAmount?: number;
  balance?: number;
  settlementAmount?: number;
}

/** The EntityManager surface these helpers need. Keeps the service mockable in unit tests. */
export interface ChainEntityManager {
  find<T>(entityClass: new (...args: never[]) => T, where: Record<string, unknown>, options?: Record<string, unknown>): Promise<T[]>;
  flush(): Promise<void>;
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
  let appuserCurrencyBalance = big(opening.appuserCurrencyBalance);

  for (const row of rows) {
    balance = balance.plus(big(row.settlementAmount));
    appuserCurrencyBalance = appuserCurrencyBalance.plus(
      big(row.appuserSettlementAmount ?? row.settlementAmount),
    );
    row.balance = toNumber(balance);
    row.appuserCurrencyBalance = toNumber(appuserCurrencyBalance);
  }

  return { appuserCurrencyBalance: toNumber(appuserCurrencyBalance), balance: toNumber(balance) };
}

/** The opening balance implied by anchoring `rows` so that the last one lands on `tail`. */
export function openingFromTail(rows: ChainRow[], tail: ChainBalance): ChainBalance {
  let balance = big(tail.balance);
  let appuserCurrencyBalance = big(tail.appuserCurrencyBalance);

  for (const row of rows) {
    balance = balance.minus(big(row.settlementAmount));
    appuserCurrencyBalance = appuserCurrencyBalance.minus(
      big(row.appuserSettlementAmount ?? row.settlementAmount),
    );
  }

  return { appuserCurrencyBalance: toNumber(appuserCurrencyBalance), balance: toNumber(balance) };
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
      // RAD-25: the chain is physical, so hidden rows count here too.
      filters: { [HIDDEN_FILTER]: false },
      orderBy: CHAIN_ORDER_BY,
    },
  );
}

/**
 * RAD-564: rebuild a bank-synced account's whole chain, anchored on `account.balance`.
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
 * taken as the opening balance verbatim and left untouched. This is the head-anchored counterpart
 * to the tail anchor: history upstream of the edit is fixed rather than re-derived from
 * `account.balance`. The row set (settled, non-null date, hidden included) and the
 * `(transactionDate, transactionKey)` order are unchanged, so the suffix boundaries match a
 * whole-account run. An anchor whose row is not in the chain — a pending or undated row, say —
 * falls back to the whole-account tail anchor, the safest rebuild this function knows.
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

  if (anchorIndex >= 0) {
    // The anchor itself is the first row that can have changed; its predecessor's stored balance is
    // still correct, so it becomes the opening and every earlier row is never written.
    startIndex = anchorIndex;
    const prior = anchorIndex > 0 ? rows[anchorIndex - 1] : undefined;
    opening = {
      appuserCurrencyBalance: prior?.appuserCurrencyBalance ?? prior?.balance ?? 0,
      balance: prior?.balance ?? 0,
    };
  } else {
    const tail: ChainBalance = {
      appuserCurrencyBalance: account.appuserCurrencyBalance ?? account.balance ?? 0,
      balance: account.balance ?? 0,
    };
    opening = openingFromTail(rows, tail);
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
