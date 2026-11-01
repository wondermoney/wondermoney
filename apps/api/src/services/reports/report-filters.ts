import type { Appuser } from '@entity/Appuser';
import type { Tenant } from '@entity/Tenant';
import type { Transaction } from '@entity/Transaction';
import type { ReportFilters } from '@validators/reports';

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

const EXCLUDED_TRANSACTION_TYPES = ['TRANSFER_IN', 'TRANSFER_OUT'] as const;
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
  const dateCondition: { $gte?: Date; $lte?: Date } = {};
  if (filters.fromDate) dateCondition.$gte = new Date(filters.fromDate);
  if (filters.toDate) dateCondition.$lte = new Date(filters.toDate);
  if (!filters.fromDate) {
    const windowStart = filters.toDate ? new Date(filters.toDate) : new Date();
    windowStart.setMonth(windowStart.getMonth() - REPORT_DEFAULT_WINDOW_MONTHS);
    dateCondition.$gte = windowStart;
  }
  where['transactionDate'] = dateCondition;

  if (filters.currencyKey) {
    where['appuserCurrencyKey'] = { code: filters.currencyKey };
  }
  if (filters.merchantKeys && filters.merchantKeys.length > 0) {
    where['transactionMerchantKey'] = { transactionMerchantKey: { $in: filters.merchantKeys.map(Number) } };
  }

  return where;
}

/** JS-side category filter: a transaction matches when any assigned category key is in the list. */
export function transactionMatchesCategoryKeys(transaction: Transaction, categoryKeys: string[]): boolean {
  const keys = new Set(categoryKeys);
  return transaction.appuserTransactionCategories.getItems().some((link) => keys.has(String(link.categoryKey.categoryKey)));
}
