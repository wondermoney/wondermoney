import type { ReportFilters } from "@/lib/api/reports/types";
import { MEMBER_FILTER_PARAM } from "@/lib/household/member-attribution";

/**
 * The rows behind a report total, as the transaction list asks the API for them.
 *
 * Every report counts a scope of transactions (the API's `reportScope`): posted only unless pending
 * is switched on, no transfers between own accounts unless switched on, and only the category lines
 * that count as spending. The list endpoint takes the same options
 * (`GET /v1/account/transaction`: `statuses`, `excludeTransfers`, `excludeNonSpending`,
 * `direction`), so a report total links to a list of exactly its rows, and the list's summed
 * amount is the report's total. The API mirrors this mapping in `listFiltersForReport`.
 *
 * The scope travels in the transactions page's URL under the API's own parameter names.
 */
export interface TransactionReportScope {
  fromDate: string;
  toDate: string;
  statuses: ("BOOKED" | "PENDING")[];
  excludeTransfers: boolean;
  excludeNonSpending: boolean;
  /** Money out only for a spending total, money in only for an income total. */
  direction?: "in" | "out";
  accountKeys: string[];
  categoryKeys: string[];
  tagKeys: string[];
  merchantKeys: string[];
  /** The report's currency filter: rows stored in this member currency. */
  memberCurrency?: string;
  /**
   * The report's member filter. It travels as the transactions page's own `member` filter
   * (`lib/household/useMemberFilter.ts`), not as part of the scope, so the page reads it from
   * there and the list's member control shows it.
   */
  memberKeys?: string[];
}

const TRANSACTIONS_PATH = "/accounts/transactions";

/** The scope of a report with these filters; `null` without a date range (the API would pick one). */
export function reportTransactionScope(
  filters: ReportFilters,
  direction?: "in" | "out",
): TransactionReportScope | null {
  if (!filters.fromDate || !filters.toDate) return null;
  return {
    fromDate: filters.fromDate,
    toDate: filters.toDate,
    statuses: filters.includePending ? ["BOOKED", "PENDING"] : ["BOOKED"],
    excludeTransfers: !filters.includeTransfers,
    excludeNonSpending: true,
    direction,
    accountKeys: filters.accountKeys ?? [],
    categoryKeys: filters.categoryKeys ?? [],
    tagKeys: filters.tagKeys ?? [],
    merchantKeys: filters.merchantKeys ?? [],
    memberCurrency: filters.currencyKey,
    ...(filters.memberKeys?.length ? { memberKeys: filters.memberKeys } : {}),
  };
}

/** The transactions page showing exactly `scope`'s rows. */
export function transactionReportScopeHref(scope: TransactionReportScope): string {
  const params = new URLSearchParams();
  params.set("fromDate", scope.fromDate);
  params.set("toDate", scope.toDate);
  params.set("statuses", scope.statuses.join(","));
  if (scope.excludeTransfers) params.set("excludeTransfers", "true");
  if (scope.excludeNonSpending) params.set("excludeNonSpending", "true");
  if (scope.direction) params.set("direction", scope.direction);
  const list = (name: string, values: string[]) => {
    if (values.length > 0) params.set(name, values.join(","));
  };
  list("accountKeys", scope.accountKeys);
  list("categoryKeys", scope.categoryKeys);
  list("tagKeys", scope.tagKeys);
  list("merchantKeys", scope.merchantKeys);
  if (scope.memberCurrency) params.set("memberCurrency", scope.memberCurrency);
  const member = scope.memberKeys?.[0];
  if (member) params.set(MEMBER_FILTER_PARAM, member);
  return `${TRANSACTIONS_PATH}?${params.toString()}`;
}

type SearchParams = Record<string, string | string[] | undefined>;

const KEY = /^[1-9]\d*$/;

function first(params: SearchParams, name: string): string | undefined {
  const value = params[name];
  return Array.isArray(value) ? value[0] : value;
}

function keys(params: SearchParams, name: string): string[] {
  return (first(params, name) ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => KEY.test(part));
}

function instant(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return Number.isNaN(new Date(value).getTime()) ? undefined : value;
}

/**
 * The scope the transactions page's URL carries, or `null` when it carries none (an ordinary
 * visit) or not a usable one. Unknown values are dropped rather than guessed at.
 */
export function parseTransactionReportScope(
  params: SearchParams,
): TransactionReportScope | null {
  const fromDate = instant(first(params, "fromDate"));
  const toDate = instant(first(params, "toDate"));
  const statuses = (first(params, "statuses") ?? "")
    .split(",")
    .filter((status): status is "BOOKED" | "PENDING" =>
      status === "BOOKED" || status === "PENDING",
    );
  if (!fromDate || !toDate || statuses.length === 0) return null;
  const direction = first(params, "direction");
  const memberCurrency = first(params, "memberCurrency");
  return {
    fromDate,
    toDate,
    statuses: [...new Set(statuses)],
    excludeTransfers: first(params, "excludeTransfers") === "true",
    excludeNonSpending: first(params, "excludeNonSpending") === "true",
    direction: direction === "in" || direction === "out" ? direction : undefined,
    accountKeys: keys(params, "accountKeys"),
    categoryKeys: keys(params, "categoryKeys"),
    tagKeys: keys(params, "tagKeys"),
    merchantKeys: keys(params, "merchantKeys"),
    memberCurrency:
      memberCurrency && /^[A-Z]{3}$/.test(memberCurrency)
        ? memberCurrency
        : undefined,
  };
}
