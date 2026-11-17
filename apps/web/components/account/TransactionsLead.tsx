"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Amount } from "@/components/ui/Amount";
import { Link } from "@/components/ui/Link";
import { Skeleton } from "@/components/ui/skeleton";
import { UnconvertedAmountsNotice } from "@/components/ui/UnconvertedAmountsNotice";
import { getAccountsOverviewCurrencyCode } from "@/lib/account/accounts-overview-state";
import type { Account } from "@/lib/api/account/useAccounts";
import useTransactions from "@/lib/api/account/useTransactions";
import { cn } from "@/lib/utils";

/**
 * The figures above the ledger: how many transactions the current view holds,
 * money in and out over the date range, and how many still need review.
 *
 * Money in and out are the transaction list's own sums (`moneyIn`,
 * `moneyOut`) for the date range alone: the rows the table lists with no
 * filter set, summed by the same query as its count and in the viewer's
 * currency, a partner's rows converted. They cover every account whatever the
 * table's filters, and the caption says so.
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
  const common = useTranslations();
  const [expanded, setExpanded] = useState(false);
  const flows = useTransactions({ fromDate, toDate, limit: 1 });
  const unreviewed = useTransactions({
    fromDate,
    toDate,
    limit: 1,
    unreviewedOnly: true,
    excludeTransfers: true,
  });
  const currency =
    flows.data?.completeness?.currencyCode ??
    getAccountsOverviewCurrencyCode(
      accounts[0]?.accountOwnerAppuserKey?.currencyKey?.code,
    );
  const moneyIn = flows.data?.moneyIn ?? 0;
  const moneyOut = flows.data?.moneyOut ?? 0;
  const reviewCount =
    unreviewed.data?.total ?? unreviewed.data?.transactions.length;

  const figure = (loading: boolean, value: React.ReactNode) =>
    loading ? <Skeleton className="h-8 w-28" aria-hidden="true" /> : value;
  const cell =
    "border-border min-w-0 px-0 sm:border-l sm:px-6 sm:first:border-l-0 sm:first:pl-0";

  return (
    <div className="relative">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground min-w-0 text-xs sm:text-sm">
          {t.rich("view-count", {
            count: viewTotal ?? 0,
            value: () => (
              <span className="text-foreground font-mono font-medium">
                {viewTotal ?? "—"}
              </span>
            ),
          })}
        </p>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {unreviewed.isPending ? (
            <Skeleton className="h-4 w-32" aria-hidden="true" />
          ) : unreviewed.isError ? (
            <span className="text-muted-foreground text-xs">
              {t("needs-review")}: —
            </span>
          ) : reviewCount ? (
            <Link
              href="/accounts/transactions/review"
              className="text-warning-text flex min-h-11 max-w-36 items-center text-xs underline underline-offset-4"
            >
              {t("review-count", { count: reviewCount })}
            </Link>
          ) : null}
          <button
            type="button"
            className="text-muted-foreground focus-visible:ring-ring flex size-11 items-center justify-center rounded-md focus-visible:ring-2 sm:hidden"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            <ChevronDown
              className={cn("size-4", expanded && "rotate-180")}
              aria-hidden="true"
            />
            <span className="sr-only">
              {common(
                expanded ? "summary-less-details" : "summary-more-details",
              )}
            </span>
          </button>
        </div>
      </div>
      <dl
        className={cn(
          "grid grid-cols-2 gap-x-6 gap-y-4 sm:gap-x-0",
          !expanded && "hidden sm:grid",
        )}
      >
        <div
          className={cn(
            cell,
            "order-2 sm:order-none",
            !expanded && "hidden sm:block",
          )}
        >
          <dt className="text-muted-foreground text-sm">{t("money-in")}</dt>
          <dd className="mt-1 text-2xl font-medium tracking-tight">
            {figure(
              flows.isPending,
              <Amount
                value={flows.isError ? null : moneyIn}
                currency={currency}
                signed
                className="font-mono"
              />,
            )}
          </dd>
        </div>
        <div
          className={cn(
            cell,
            "order-2 sm:order-none",
            !expanded && "hidden sm:block",
          )}
        >
          <dt className="text-muted-foreground text-sm">{t("money-out")}</dt>
          <dd className="mt-1 text-2xl font-medium tracking-tight">
            {figure(
              flows.isPending,
              <Amount
                value={flows.isError ? null : -moneyOut}
                currency={currency}
                className="font-mono"
              />,
            )}
          </dd>
        </div>
      </dl>
      <p
        className={cn(
          "text-muted-foreground mt-3 text-xs",
          !expanded && "hidden sm:block",
        )}
      >
        {t("flows-caption")}
      </p>
      <UnconvertedAmountsNotice
        completeness={flows.data?.completeness ?? undefined}
        className="mt-1 text-xs"
      />
    </div>
  );
}
