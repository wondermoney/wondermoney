import type { Appuser } from '@entity/Appuser';
import type { Tenant } from '@entity/Tenant';
import type { Transaction } from '@entity/Transaction';
import { type CategoryLine, hasLineInCategories } from '@service/transaction/category-lines';
import type { TransactionDateRange } from '@service/transaction/transaction-date-range';
import { type TransactionScope, transactionScopeWhere } from '@service/transaction/transaction-scope';
import { buildTagWhere, type TransactionFilterInput } from '@service/transaction/transaction-total.service';
import type { ReportFilters } from '@validators/reports';

import { resolveReportTimeZone } from './report-months';

/**
 * Default lookback applied when a report request supplies no `fromDate`.
 * 24 months covers year-over-year comparison, which is the widest view any report
 * offers, while bounding what would otherwise be an unbounded full-history scan.
 */
const REPORT_DEFAULT_WINDOW_MONTHS = 24;

export interface ReportServiceInput {
  filters: ReportFilters;
  tenant: Tenant;
  user: Appuser;
}

/**
 * The report's date range on the viewer's calendar. `fromDate`/`toDate` are optional on all twelve
 * report routes; without a default, an unparameterised request would load the tenant's ENTIRE
 * transaction history (Sankey does so with a four-level populate). A window is always applied: the
 * caller's if given, otherwise a bounded default, here rather than per route so no report can opt
 * out of it. A bank booking (a date with no time) counts on its calendar day in the report's time
 * zone (`transaction-date-range.ts`).
 */
export function reportDateRange(filters: ReportFilters): TransactionDateRange & { from: Date } {
  let from: Date;
  if (filters.fromDate) from = new Date(filters.fromDate);
  else {
    from = filters.toDate ? new Date(filters.toDate) : new Date();
    from.setMonth(from.getMonth() - REPORT_DEFAULT_WINDOW_MONTHS);
  }
  return { from, timeZone: resolveReportTimeZone(filters.timezone), to: filters.toDate ? new Date(filters.toDate) : undefined };
}

/**
 * Which transactions a report counts (`transaction-scope.ts`): booked only unless pending is asked
 * for, no transfers unless asked for, never a hidden row, and never a row wholly in categories that
 * are not spending (a report adds only spending lines, `spendingLinesOf`). The tenant, privacy and
 * deleted rules hold whatever the query surface.
 */
export function reportScope(filters: ReportFilters, tenant: Pick<Tenant, 'tenantKey'>, user: Pick<Appuser, 'appuserKey'>, options: { accountKeys?: readonly number[] } = {}): TransactionScope {
  return {
    accountKeys: options.accountKeys ?? filters.accountKeys?.map(Number),
    dateRange: reportDateRange(filters),
    includeHidden: false,
    includeNonSpending: false,
    includeTransfers: filters.includeTransfers,
    memberCurrencyCode: filters.currencyKey,
    merchantKeys: filters.merchantKeys?.map(Number),
    statuses: filters.includePending ? ['BOOKED', 'PENDING'] : ['BOOKED'],
    tenantKey: tenant.tenantKey,
    viewerAppuserKey: user.appuserKey,
  };
}

/**
 * The report's rows as a MikroORM `where`: its scope, and its tag filter (any of the tags, as an
 * EXISTS on the link table; links only ever join a transaction to a tag of the same household).
 * The category filter is applied in JavaScript per line (`lineMatchesCategoryKeys`).
 */
export function buildTransactionWhere(filters: ReportFilters, tenant: Tenant, user: Appuser, options: { accountKeys?: readonly number[] } = {}): Record<string, unknown> {
  return {
    ...transactionScopeWhere(reportScope(filters, tenant, user, options)),
    ...buildTagWhere(filters.tagKeys?.map(Number)),
  };
}

/**
 * The transaction list's filters (`GET /v1/account/transaction`) for exactly the rows a report
 * counts, so a report total can link to a list whose summed amount is that total. Add `direction`
 * for a report that counts only money in or only money out (spending by category: `out`).
 */
export function listFiltersForReport(filters: ReportFilters): TransactionFilterInput {
  const range = reportDateRange(filters);
  return {
    accountKeys: filters.accountKeys?.map(Number),
    categoryKeys: filters.categoryKeys ? { includeUncategorized: false, keys: filters.categoryKeys.map(Number) } : undefined,
    excludeNonSpending: true,
    excludeTransfers: !filters.includeTransfers,
    fromDate: range.from,
    memberCurrencyCode: filters.currencyKey,
    merchantKeys: filters.merchantKeys?.map(Number),
    statuses: filters.includePending ? ['BOOKED', 'PENDING'] : ['BOOKED'],
    tagKeys: filters.tagKeys?.map(Number),
    timeZone: range.timeZone,
    toDate: range.to,
  };
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
