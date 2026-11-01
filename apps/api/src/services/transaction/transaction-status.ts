import type { FilterQuery } from '@mikro-orm/core';

import type { Transaction } from '@entity/Transaction';

/**
 * Which stored transactions are money that moved.
 *
 * - `BOOKED` has settled.
 * - `PENDING` is committed but not settled. Whether it counts is each reader's call and stays
 *   as it was: the balance chain and the reports' default leave it out, budgets and the account
 *   aggregates count it.
 * - `EXPIRED` never moved and never will: a pending row that dropped out of the provider feed, or
 *   a row the bank rejected or cancelled that the sync retracted. It counts nowhere: in no
 *   total, list, balance, recurring pattern or candidate search.
 * - A row with no status is a legacy row and counts as before.
 *
 * Every reader that sums, lists or analyses transactions applies the rule through one of the
 * three forms below, so there is no string literal to get wrong at the call site.
 */
export const EXPIRED_TRANSACTION_STATUS = 'EXPIRED';

/** True when a status name marks a row whose money never moved. */
export function isExpiredStatusName(name: null | string | undefined): boolean {
  return name === EXPIRED_TRANSACTION_STATUS;
}

/**
 * MikroORM condition on `Transaction`: no status, or any status but EXPIRED.
 *
 * The `null` branch matters: `name <> 'EXPIRED'` alone is unknown for a row with no status, and
 * would drop it.
 */
export const NOT_EXPIRED_TRANSACTION = {
  $or: [{ transactionStatusKey: null }, { transactionStatusKey: { name: { $ne: EXPIRED_TRANSACTION_STATUS } } }],
} satisfies FilterQuery<Transaction>;

/**
 * Add the not-EXPIRED condition to a `Transaction` where clause, under `$and` so it composes with
 * any `$or` the clause already has. Also usable on a nested relation condition
 * (`{ transactionKey: excludeExpired({ ... }) }`).
 */
export function excludeExpired<Where extends FilterQuery<Transaction>>(where: Where): Where {
  const clause = where as Record<string, unknown> & { $and?: unknown[] };
  return { ...clause, $and: [...(clause.$and ?? []), NOT_EXPIRED_TRANSACTION] } as Where;
}

/**
 * Raw SQL form for Kysely and hand-written queries: true unless the row at `alias` is EXPIRED.
 *
 * Written as `not exists` so it needs no join, keeps a status-less row, and can sit in a LEFT
 * JOIN's `on` clause without turning it into an inner join. `alias` is a table alias chosen in
 * code, never input.
 */
export function notExpiredTransactionSql(alias: string): string {
  return `not exists (select 1 from "transaction_status" expired_status where expired_status."transaction_status_key" = "${alias}"."transaction_status_key" and expired_status."name" = '${EXPIRED_TRANSACTION_STATUS}')`;
}
