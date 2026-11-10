import type { Appuser } from '@entity/Appuser';
import type { Tenant } from '@entity/Tenant';
import type { Transaction } from '@entity/Transaction';
import { type CategoryLine, hasLineInCategories } from '@service/transaction/category-lines';
import { transactionDateRangeWhere } from '@service/transaction/transaction-date-range';
import type { ReportFilters } from '@validators/reports';

import { resolveReportTimeZone } from './report-months';

/**
 * Default lookback applied when a report request supplies no `fromDate`.
 * 24 months covers year-over-year comparison, which is the widest view any report
 * offers, while bounding what would otherwise be an unbounded full-history scan.
 */
const REPORT_DEFAULT_WINDOW_MONTHS = 24;

/**
 * Shared transaction scoping for report aggregations.
 *
 * Raw QueryBuilder/Kysely execution bypasses MikroORM's global tenant filter, and
 * even `em.find` only engages it once a tenant context is stamped on the EM. To
 * keep reports safe regardless of the query surface, every report builds its
 * where condition through here: explicit tenant scope + per-account privacy
 * carve-out (a private account's transactions are owner-only) +
 * soft-delete + status/transfer defaults.
 */

/**
 * Transaction types that move money between the household's own accounts (a matched pair, or a row
 * a user marked as a transfer). Never income or spending: reports leave them out by default, and
 * budgets and the dashboard always do.
 */
export const TRANSFER_TYPE_NAMES = ['TRANSFER_IN', 'TRANSFER_OUT'] as const;
const EXCLUDED_TRANSACTION_TYPES = TRANSFER_TYPE_NAMES;

/** Whether the row is a transfer ({@link TRANSFER_TYPE_NAMES}). Populate `transactionTypeKey` first. */
export function isTransferTransaction(transaction: Pick<Transaction, 'transactionTypeKey'>): boolean {
  const name = transaction.transactionTypeKey?.name;
  return name !== undefined && (TRANSFER_TYPE_NAMES as readonly string[]).includes(name);
}

/**
 * SQL: the row aliased `alias` (unquoted) is not a transfer. A row with no type is not one. `alias`
 * is a table alias written by the caller, never input.
 */
export function notTransferSql(alias: string): string {
  return `not exists (select 1 from "transaction_type" transfer_type where transfer_type."transaction_type_key" = "${alias}"."transaction_type_key" and transfer_type."name" in ('TRANSFER_IN', 'TRANSFER_OUT'))`;
}
const BOOKED_ONLY_STATUSES = ['BOOKED'] as const;
const BOOKED_OR_PENDING_STATUSES = ['BOOKED', 'PENDING'] as const;

export interface ReportServiceInput {
  filters: ReportFilters;
  tenant: Tenant;
  user: Appuser;
}

export function buildTransactionWhere(filters: ReportFilters, tenant: Tenant, user: Appuser): Record<string, unknown> {
  const accountCondition: Record<string, unknown> = {
    $or: [{ isPrivate: false }, { accountOwnerAppuserKey: user }],
  };
  if (filters.accountKeys && filters.accountKeys.length > 0) {
    accountCondition['accountKey'] = { $in: filters.accountKeys.map(Number) };
  }

  const where: Record<string, unknown> = {
    accountKey: accountCondition,
    deletedAt: undefined,
    tenantKey: tenant,
    transactionStatusKey: {
      name: { $in: filters.includePending ? [...BOOKED_OR_PENDING_STATUSES] : [...BOOKED_ONLY_STATUSES] },
    },
  };

  if (!filters.includeTransfers) {
    where['transactionTypeKey'] = { name: { $nin: [...EXCLUDED_TRANSACTION_TYPES] } };
  }

  // `fromDate`/`toDate` are optional on all twelve report routes; without a default, an
  // unparameterised request would load the tenant's ENTIRE transaction history (Sankey does
  // so with a four-level populate). A window is always applied: the caller's if given,
  // otherwise a bounded default.
  // This is enforced here, in the shared builder, rather than per-route so no report can
  // opt out of it by construction.
  // A bank booking (a date with no time) counts on its calendar day in the report's time zone
  // (`transaction-date-range.ts`).
  let from: Date;
  if (filters.fromDate) from = new Date(filters.fromDate);
  else {
    from = filters.toDate ? new Date(filters.toDate) : new Date();
    from.setMonth(from.getMonth() - REPORT_DEFAULT_WINDOW_MONTHS);
  }
  Object.assign(where, transactionDateRangeWhere({ from, timeZone: resolveReportTimeZone(filters.timezone), to: filters.toDate ? new Date(filters.toDate) : undefined }));

  if (filters.currencyKey) {
    where['appuserCurrencyKey'] = { code: filters.currencyKey };
  }
  if (filters.merchantKeys && filters.merchantKeys.length > 0) {
    where['transactionMerchantKey'] = { transactionMerchantKey: { $in: filters.merchantKeys.map(Number) } };
  }
  if (filters.tagKeys && filters.tagKeys.length > 0) {
    // Any-of, as an EXISTS on the link table. Links only ever join a transaction to a tag of the
    // same household, and the tenant and privacy conditions above still decide which rows count.
    where['transactionTags'] = { $some: { tagKey: { $in: filters.tagKeys.map(Number) } } };
  }

  return where;
}

/**
 * JS-side category filter: a transaction matches when any of its category lines is in the list
 * (its category, or any line of a split). Populate `CATEGORY_LINE_POPULATE` first. A report that
 * totals amounts counts only the matching lines (`lineMatchesCategoryKeys`).
 */
export function transactionMatchesCategoryKeys(transaction: Transaction, categoryKeys: string[]): boolean {
  return hasLineInCategories(transaction, categoryKeys);
}

/** Whether one category line passes the report's category filter (no filter: every line). */
export function lineMatchesCategoryKeys(line: CategoryLine, categoryKeys: string[] | undefined): boolean {
  if (categoryKeys === undefined) return true;
  return line.category !== null && categoryKeys.includes(String(line.category.categoryKey));
}
