import type { FilterQuery } from '@mikro-orm/core';
import type { QBFilterQuery } from '@mikro-orm/postgresql';

import { DI } from '@app/database/di';
import { HIDDEN_FILTER } from '@app/database/filters/tenant-filter';
import { CategorizationConfidence, Transaction } from '@entity/Transaction';
import type { MemberFilter } from '@service/household/member-attribution';
import type { ReportCompleteness } from '@service/reports/report-currency';

import { type TransactionScope, transactionScopeWhere, type TransactionStatusName } from './transaction-scope';
import { getTransactionTotals } from './transaction-totals';

/**
 * The result count and summed amount for `GET /v1/account/transaction`.
 *
 * The table pages rows, so the total has to come from the server: the browser
 * only knows the loaded set ("12 of 22"), not the real one ("12 of 8,623").
 *
 * The rows are a {@link TransactionScope} (`transaction-scope.ts`), like every report and
 * dashboard total, plus the table's own filters. The scope options default to what the table has
 * always shown (every status but EXPIRED, transfers and every category included); a report links
 * to its own rows by passing its options (`listFiltersForReport`), and the summed amount is then
 * the report's total.
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
  /** Money in or money out only (`TransactionScope.direction`). */
  direction?: 'in' | 'out';
  /** Leave out rows wholly in categories that are not spending; the amount adds only spending lines. */
  excludeNonSpending?: boolean;
  /** Leave out transfers between own accounts. */
  excludeTransfers?: boolean;
  fromDate?: Date;
  includeHidden?: boolean;
  /** Only rows stored in this member currency, by code (a report's currency filter). */
  memberCurrencyCode?: string;
  /** Only rows attributed to these members, or to Shared (`member-attribution.ts`). */
  members?: MemberFilter;
  /** Merchant keys; a transaction matches when it has one of them. */
  merchantKeys?: number[];
  /** Only these statuses; absent means every status but EXPIRED, legacy rows with none included. */
  statuses?: TransactionStatusName[];
  /** Tag keys; a transaction matches when it carries any of them. Empty/absent means no tag filter. */
  tagKeys?: number[];
  /** The viewer's IANA time zone: date-only rows are matched by calendar day (`transaction-date-range.ts`). */
  timeZone?: string;
  toDate?: Date;
  /** `TransactionType.name` values, e.g. `credit` / `debit`. */
  transactionTypes?: string[];
  unreviewedOnly?: boolean;
}

/** Who is looking: the household and the member, whose currency the summed amount is in. */
export interface TransactionViewer {
  currency: { code: string; currencyKey: number };
  tenantKey: number;
  viewerAppuserKey: number;
}

/**
 * The list's scope: the options the request passed, else what the table has always shown. The
 * table carries no status, so an EXPIRED row would read as money that moved and land in the review
 * inbox: it is neither listed nor counted. Pending and status-less rows stay.
 */
export function buildTransactionWhere(filters: TransactionFilterInput, viewer: Pick<TransactionViewer, 'tenantKey' | 'viewerAppuserKey'>): FilterQuery<Transaction> {
  const { categoryKeys, confidence, tagKeys, transactionTypes, unreviewedOnly } = filters;

  return {
    ...transactionScopeWhere(listScope(filters, viewer)),
    ...(unreviewedOnly ? { reviewed: false } : {}),
    ...(confidence ? { categorizationConfidence: confidence } : {}),
    ...(transactionTypes && transactionTypes.length > 0
      ? { transactionTypeKey: { name: { $in: transactionTypes } } }
      : {}),
    ...buildCategoryWhere(categoryKeys),
    ...buildTagWhere(tagKeys),
  };
}

export function listScope(filters: TransactionFilterInput, viewer: Pick<TransactionViewer, 'tenantKey' | 'viewerAppuserKey'>): TransactionScope {
  return {
    accountKeys: filters.accountKeys,
    dateRange: { from: filters.fromDate, timeZone: filters.timeZone, to: filters.toDate },
    direction: filters.direction,
    includeHidden: filters.includeHidden === true,
    includeNonSpending: filters.excludeNonSpending !== true,
    includeTransfers: filters.excludeTransfers !== true,
    memberCurrencyCode: filters.memberCurrencyCode,
    members: filters.members,
    merchantKeys: filters.merchantKeys,
    statuses: filters.statuses && filters.statuses.length > 0 ? filters.statuses : 'not-expired',
    tenantKey: viewer.tenantKey,
    viewerAppuserKey: viewer.viewerAppuserKey,
  };
}

/** Whether the request asked for a report's scope rather than the table's default one. */
export function hasReportScope(filters: TransactionFilterInput): boolean {
  return (filters.statuses?.length ?? 0) > 0 || filters.excludeTransfers === true || filters.excludeNonSpending === true || filters.direction !== undefined
    || filters.memberCurrencyCode !== undefined || (filters.merchantKeys?.length ?? 0) > 0 || filters.members !== undefined;
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
export function buildTagWhere(tagKeys: readonly number[] | undefined): Record<string, unknown> {
  if (!tagKeys || tagKeys.length === 0) return {};
  return { transactionTags: { $some: { tagKey: { $in: tagKeys } } } };
}

/** The list's total: how many rows match, and what they add up to. */
export interface TransactionListTotal {
  /** In the viewer's currency, to 4 decimals; only the lines the scope counts (`excludeNonSpending`, a category filter). */
  amount: number;
  completeness: ReportCompleteness;
  count: number;
  /** The part of `amount` from rows that add money, in the same currency. */
  moneyIn: number;
  /** The part from rows that take money, as a positive amount: `amount` is `moneyIn - moneyOut`. */
  moneyOut: number;
}

/**
 * Rows matching the filters as applied, before `limit`, counted and summed in one query.
 *
 * The rows are the ones `em.find` lists: the same `where`, through the same default MikroORM
 * filters (the tenant filter with its private-account carve-out, and the hidden filter), so the
 * number can never describe rows the caller may not read. The scope's own tenant and privacy
 * conditions hold where no filter is set too.
 *
 * `includeHidden` disables the hidden filter as well as the scope's hidden condition, which is
 * why it is applied as an option and not only in the `where`.
 *
 * The amount is summed like the dashboard's cash flow (`transaction-totals.ts`): a split row adds
 * only its lines in the filtered categories, and with `excludeNonSpending` only its spending lines.
 */
export async function getTransactionTotal(filters: TransactionFilterInput, viewer: TransactionViewer): Promise<TransactionListTotal> {
  const listed = DI.em.createQueryBuilder(Transaction, 'listed').select('listed.transactionKey').where(buildTransactionWhere(filters, viewer) as QBFilterQuery<Transaction, 'listed'>);
  await listed.applyFilters(filters.includeHidden === true ? { [HIDDEN_FILTER]: false } : {});
  const totals = await getTransactionTotals(DI.em, {
    currency: viewer.currency,
    lines: { categoryKeys: filters.categoryKeys, spendingOnly: filters.excludeNonSpending === true },
    rows: { params: [...listed.getParams()], sql: `t.transaction_key in (${listed.getQuery()})` },
    tenantKey: viewer.tenantKey,
  });
  const total = totals.months.get('') ?? { amount: 0, moneyIn: 0, moneyOut: 0 };
  return { ...total, completeness: totals.completeness, count: totals.count };
}
