import type { FilterQuery } from '@mikro-orm/core';

import { DI } from '@app/database/di';
import { HIDDEN_FILTER } from '@app/database/filters/tenant-filter';
import { CategorizationConfidence, Transaction } from '@entity/Transaction';

import { transactionDateRangeWhere } from './transaction-date-range';
import { excludeExpired } from './transaction-status';

/**
 * The result count for `GET /v1/account/transaction`.
 *
 * The table pages rows, so the total has to come from the server: the browser
 * only knows the loaded set ("12 of 22"), not the real one ("12 of 8,623").
 *
 * ## No facet counts
 *
 * There are no per-value counts for `confidence`, `reviewed` or `hidden`: they
 * would cost extra `em.count` calls per request and nothing consumes them. If
 * filter chips ever do want counts, add them as one grouped query through
 * `QueryBuilder.applyFilters()`, together with the code that reads them.
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
  /** Account keys the table is scoped to. Empty/absent means every account. */
  accountKeys?: number[];
  /** Category keys, plus whether uncategorized transactions are wanted too. */
  categoryKeys?: { includeUncategorized: boolean; keys: number[] };
  confidence?: CategorizationConfidence;
  fromDate?: Date;
  includeHidden?: boolean;
  /** Tag keys; a transaction matches when it carries any of them. Empty/absent means no tag filter. */
  tagKeys?: number[];
  /** The viewer's IANA time zone: date-only rows are matched by calendar day (`transaction-date-range.ts`). */
  timeZone?: string;
  toDate?: Date;
  /** `TransactionType.name` values, e.g. `credit` / `debit`. */
  transactionTypes?: string[];
  unreviewedOnly?: boolean;
}

export function buildTransactionWhere(filters: TransactionFilterInput): FilterQuery<Transaction> {
  const { accountKeys, categoryKeys, confidence, fromDate, tagKeys, timeZone, toDate, transactionTypes, unreviewedOnly } = filters;

  // The table carries no status, so an EXPIRED row would read as money that moved and land
  // in the review inbox: it is neither listed nor counted. Pending and status-less rows stay.
  return excludeExpired({
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
    ...buildTagWhere(tagKeys),
    ...transactionDateRangeWhere({ from: fromDate, timeZone, to: toDate }),
  });
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
 * A split transaction matches when any of its lines does: a named category on a line, or an
 * uncategorized line for "Uncategorized".
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

  // A split transaction matches through its lines, an unsplit one through its single assignment
  // (a split keeps the largest line's category as its assignment, which must not stand in for the
  // others). `deletedAt: null` keeps removed lines out of the EXISTS subqueries.
  const notSplit = { splits: { $none: { deletedAt: null } } };
  const branches: Record<string, unknown>[] = [];
  if (keys.length > 0) {
    branches.push({ appuserTransactionCategories: { $some: { categoryKey: { $in: keys } } }, ...notSplit });
    branches.push({ splits: { $some: { categoryKey: { $in: keys }, deletedAt: null } } });
  }
  if (includeUncategorized) {
    branches.push({ appuserTransactionCategories: { $none: {} }, ...notSplit });
    branches.push({ splits: { $some: { categoryKey: null, deletedAt: null } } });
  }

  return { $or: branches };
}

/**
 * The tag filter: any of the tags. `$some` is an EXISTS on the link table, so it never shares a
 * join with the category branches. The links are read through the tenant filter like the rows.
 */
function buildTagWhere(tagKeys: TransactionFilterInput['tagKeys']): Record<string, unknown> {
  if (!tagKeys || tagKeys.length === 0) return {};
  return { transactionTags: { $some: { tagKey: { $in: tagKeys } } } };
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
