import type { FilterQuery } from '@mikro-orm/core';

import { DI } from '@app/database/di';
import { HIDDEN_FILTER } from '@app/database/filters/tenant-filter';
import { CategorizationConfidence, Transaction } from '@entity/Transaction';

/**
 * The result count for `GET /v1/account/transaction`.
 *
 * The endpoint used to return `{ transactions }` and nothing else: no total, no
 * pagination metadata. Everything the table knew, it knew because every row was
 * already in the browser, which is why the footer could honestly say
 * "12 of 22 results" for the loaded set but not "12 of 8,623".
 *
 * ## What happened to the facet counts (RAD-561 → RAD-576/RAD-578)
 *
 * RAD-561 also returned per-value counts for `confidence`, `reviewed` and
 * `hidden`, so a filter chip could say how many rows it matched before you
 * clicked it. Eight extra `em.count` calls per request. Nothing ever consumed
 * them: `GetTransactionsResponse` typed the field and that was the end of it.
 *
 * They are gone rather than optimised. RAD-578 was originally going to collapse
 * the nine queries into a grouped one — its own premise was that
 * `QueryBuilder.applyFilters()` makes that safe, which is true — but a cheaper
 * way to run a query is worth nothing when the answer is discarded. If filter
 * chips ever do want counts, bring them back deliberately, as one grouped query
 * through `applyFilters`, and read them on the same day.
 *
 * ## Why counted per request and not cached
 *
 * A total is only correct for one exact combination of (tenant, viewer, filters),
 * and every write to a transaction invalidates it. A response cache keyed on all
 * of that would miss nearly every time while still going stale. If this ever
 * becomes hot, the answer is a per-tenant rollup maintained on write, not a cache
 * in front of it.
 */

/** Filters the endpoint accepts, already parsed. */
export interface TransactionFilterInput {
  /** RAD-579 — account keys the table is scoped to. Empty/absent means every account. */
  accountKeys?: number[];
  /** RAD-579 — category keys, plus whether uncategorized transactions are wanted too. */
  categoryKeys?: { includeUncategorized: boolean; keys: number[] };
  confidence?: CategorizationConfidence;
  fromDate?: Date;
  includeHidden?: boolean;
  toDate?: Date;
  /** RAD-579 — `TransactionType.name` values, e.g. `credit` / `debit`. */
  transactionTypes?: string[];
  unreviewedOnly?: boolean;
}

export function buildTransactionWhere(filters: TransactionFilterInput): FilterQuery<Transaction> {
  const { accountKeys, categoryKeys, confidence, fromDate, toDate, transactionTypes, unreviewedOnly } = filters;

  return {
    accountKey: {
      deletedAt: undefined,
      ...(accountKeys && accountKeys.length > 0 ? { accountKey: { $in: accountKeys } } : {}),
    },
    deletedAt: undefined,
    ...(unreviewedOnly ? { reviewed: false } : {}),
    ...(confidence ? { categorizationConfidence: confidence } : {}),
    ...(transactionTypes && transactionTypes.length > 0
      ? { transactionTypeKey: { name: { $in: transactionTypes } } }
      : {}),
    ...buildCategoryWhere(categoryKeys),
    ...((fromDate ?? toDate)
      ? {
          transactionDate: {
            ...(fromDate ? { $gte: fromDate } : {}),
            ...(toDate ? { $lte: toDate } : {}),
          },
        }
      : {}),
  } as FilterQuery<Transaction>;
}

/**
 * The category filter, which is the only one of the three that is not a plain `$in`.
 *
 * The table lets a user select real categories *and* an "Uncategorized" pseudo-value at the same
 * time, and treats them as a union — the browser code is literally
 * `isUncategorizedMatch || isCategoryMatch`. "Uncategorized" is the absence of any
 * `AppuserTransactionCategory` row, not a category with a key, so the two halves cannot be
 * expressed as one `$in` and the union has to be an explicit `$or`.
 *
 * Selecting *only* "Uncategorized" is a meaningful filter on its own, which is why the
 * uncategorized branch is emitted even when `keys` is empty.
 *
 * `$some` is load-bearing and must not be simplified to the implicit collection form. Written as
 * `{ appuserTransactionCategories: { categoryKey: { $in: keys } } }`, MikroORM folds both `$or`
 * branches into a *single* join on the collection, where the `$in` and the `$none` contradict and
 * the `$in` wins — the union silently degrades to the named-categories branch alone. `$some`
 * forces a separate `EXISTS` subquery per branch. Measured against real data: implicit gave 171
 * where the union is 2,976 (171 named + 2,805 uncategorized); `$some` gives 2,976.
 */
function buildCategoryWhere(
  categoryKeys: TransactionFilterInput['categoryKeys'],
): Record<string, unknown> {
  if (!categoryKeys) return {};

  const { includeUncategorized, keys } = categoryKeys;
  if (!includeUncategorized && keys.length === 0) return {};

  const branches: Record<string, unknown>[] = [];
  if (keys.length > 0) branches.push({ appuserTransactionCategories: { $some: { categoryKey: { $in: keys } } } });
  if (includeUncategorized) branches.push({ appuserTransactionCategories: { $none: {} } });

  return branches.length === 1 ? branches[0]! : { $or: branches };
}

/**
 * Rows matching the filters as applied, before `limit`.
 *
 * `em.count` goes through both default MikroORM filters — the tenant filter with
 * its private-account carve-out, and the hidden filter — exactly as `em.find`
 * does, so the number can never describe rows the caller may not read.
 *
 * `includeHidden` is not a `where` clause; it disables the hidden filter, which
 * is why it is passed as an option rather than folded into `buildTransactionWhere`.
 */
export async function getTransactionTotal(filters: TransactionFilterInput): Promise<number> {
  return DI.em.count(
    Transaction,
    buildTransactionWhere(filters),
    filters.includeHidden === true ? { filters: { [HIDDEN_FILTER]: false } } : {},
  );
}
