"use client";

import { useTranslations } from "next-intl";

import { Amount } from "@/components/ui/Amount";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/components/ui/Link";
import { Skeleton } from "@/components/ui/skeleton";
import { aggregateMetrics } from "@/lib/account/accounts-metrics";
import { getAccountsOverviewCurrencyCode } from "@/lib/account/accounts-overview-state";
import type { Account } from "@/lib/api/account/useAccounts";
import useAccountsMetrics from "@/lib/api/account/useAccountsMetrics";
import useTransactions from "@/lib/api/account/useTransactions";
import { cn } from "@/lib/utils";

/**
 * The figures above the ledger: how many transactions the current view holds,
 * money in and out over the date range, and how many still need review.
 *
 * Money in and out come from the same metrics, summed the same way, as the
 * Accounts overview, so the two pages agree; they cover every account in the
 * date range, whatever the table's filters, and the caption says so.
 */
export function TransactionsLead({
  accounts,
  fromDate,
  toDate,
  viewTotal,
}: {
  accounts: Account[];
  fromDate?: Date;
  toDate?: Date;
  /** The server's count for the rows the table holds, filters included. */
  viewTotal?: number | null;
}) {
  const t = useTranslations("transactionsPage");
  const metrics = useAccountsMetrics({ fromDate, toDate });
  const unreviewed = useTransactions({
    fromDate,
    toDate,
    limit: 1,
    unreviewedOnly: true,
  });
  const currency = getAccountsOverviewCurrencyCode(
    accounts[0]?.accountOwnerAppuserKey?.currencyKey?.code,
  );
  const totals =
    metrics.data?.metrics && metrics.data.metrics.length > 0
      ? aggregateMetrics(metrics.data.metrics)
      : null;
  const reviewCount =
    unreviewed.data?.total ?? unreviewed.data?.transactions.length;

  const figure = (loading: boolean, value: React.ReactNode) =>
    loading ? <Skeleton className="h-8 w-28" aria-hidden="true" /> : value;
  const cell =
    "border-border min-w-0 px-0 sm:border-l sm:px-6 sm:first:border-l-0 sm:first:pl-0";

  return (
    <div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4 sm:gap-x-0">
        <div className={cell}>
          <dt className="text-muted-foreground text-sm">{t("in-view")}</dt>
          <dd className="text-foreground mt-1 font-mono text-2xl font-medium tracking-tight">
            {viewTotal ?? "—"}
          </dd>
        </div>
        <div className={cell}>
          <dt className="text-muted-foreground text-sm">{t("money-in")}</dt>
          <dd className="mt-1 text-2xl font-medium tracking-tight">
            {figure(
              metrics.isPending,
              <Amount
                value={metrics.isError ? null : (totals?.inflowCurrent ?? 0)}
                currency={currency}
                signed
                className="font-mono"
              />,
            )}
          </dd>
        </div>
        <div className={cell}>
          <dt className="text-muted-foreground text-sm">{t("money-out")}</dt>
          <dd className="mt-1 text-2xl font-medium tracking-tight">
            {figure(
              metrics.isPending,
              <Amount
                value={metrics.isError ? null : -(totals?.outflowCurrent ?? 0)}
                currency={currency}
                className="font-mono"
              />,
            )}
          </dd>
        </div>
        <div className={cell}>
          <dt className="text-muted-foreground text-sm">{t("needs-review")}</dt>
          <dd className="mt-1 flex items-baseline gap-3">
            {figure(
              unreviewed.isPending,
              <span
                className={cn(
                  "font-mono text-2xl font-medium tracking-tight",
                  reviewCount ? "text-warning-text" : "text-foreground",
                )}
              >
                {unreviewed.isError ? "—" : (reviewCount ?? 0)}
              </span>,
            )}
            {reviewCount ? (
              <Link
                href="/accounts/transactions/review"
                className={cn(
                  buttonVariants({ variant: "link" }),
                  "h-auto p-0",
                )}
              >
                {t("review-link")}
              </Link>
            ) : null}
          </dd>
        </div>
      </dl>
      <p className="text-muted-foreground mt-3 text-xs">{t("flows-caption")}</p>
    </div>
  );
}
