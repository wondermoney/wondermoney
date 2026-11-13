"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";

import { TransactionAmount } from "@/components/account/TransactionAmount";
import { buttonVariants } from "@/components/ui/button";
import DataLoadError from "@/components/ui/DataLoadError";
import { Link } from "@/components/ui/Link";
import {
  RowsSkeleton,
  Section,
  SectionEmpty,
} from "@/components/ui/RuledSection";
import useTransactionReviewSummary from "@/lib/api/account/useTransactionReviewSummary";
import useTransactions, {
  type Transaction,
} from "@/lib/api/account/useTransactions";
import { type MemberFilter, memberKeysFor } from "@/lib/household/member-attribution";
import { cn } from "@/lib/utils";
import { getCategoryDisplayName } from "@/lib/utils/categories";
import { transactionDisplayDate } from "@/lib/utils/transaction-date";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";
import { useFormatShortDate } from "@/lib/utils/useFormatShortDate";

const SHOWN = 6;
const LATEST = { limit: SHOWN } as const;

function TransactionRow({ transaction }: { transaction: Transaction }) {
  const t = useTranslations();
  const formatShortDate = useFormatShortDate();
  const category = transaction.appuserTransactionCategories?.[0];
  const needsReview = transaction.reviewed === false;

  return (
    <tr
      role="row"
      className="border-border grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 border-b py-3 md:table-row md:py-0"
    >
      <td
        role="cell"
        className="text-muted-foreground hidden py-3 pr-4 text-sm whitespace-nowrap md:table-cell"
      >
        {formatShortDate(transactionDisplayDate(transaction.transactionDate))}
      </td>
      <th
        role="rowheader"
        scope="row"
        className="min-w-0 py-0 text-left font-normal md:py-3 md:pr-4"
      >
        <span className="text-foreground block truncate text-sm font-medium">
          {transaction.description}
        </span>
        <span className="text-muted-foreground block truncate text-sm">
          <span className="md:hidden">
            {formatShortDate(
              transactionDisplayDate(transaction.transactionDate),
            )}
            ,{" "}
          </span>
          {transaction.accountKey.accountName}
        </span>
      </th>
      <td
        role="cell"
        className="col-start-1 row-start-2 py-0 text-sm md:py-3 md:pr-4"
      >
        <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {category ? (
            <span className="text-muted-foreground">
              {getCategoryDisplayName(t, category.name)}
            </span>
          ) : (
            <span className="border-muted-foreground text-muted-foreground rounded-sm border border-dashed px-1.5 text-xs">
              {t("homeOverview.latest.uncategorised")}
            </span>
          )}
          {needsReview ? (
            <span className="text-warning-text text-xs font-medium">
              {t("homeOverview.latest.needs-review")}
            </span>
          ) : null}
        </span>
      </td>
      <td
        role="cell"
        className="col-start-2 row-span-2 row-start-1 self-center py-0 text-right md:py-3"
      >
        <TransactionAmount
          transaction={transaction}
          signed
          className="font-mono text-sm md:text-base"
        />
      </td>
    </tr>
  );
}

/**
 * The review inbox at a glance, above the latest transactions: how many rows are
 * waiting, what they add up to, and the way in. With nothing waiting it says so
 * instead of showing an empty action. It is not a dashboard section of its own —
 * it belongs to the latest-transactions block, so hiding that block hides it too.
 *
 * The amount goes through `useFormatCurrency()`, which masks it in privacy mode.
 */
function ReviewStatusRow() {
  const t = useTranslations("homeOverview.latest");
  const formatCurrency = useFormatCurrency();
  const summary = useTransactionReviewSummary();
  const review = summary.data;

  // Still loading, or the summary failed: the section's rows stand on their own.
  if (!review) return null;

  if (review.count === 0) {
    return (
      <p className="border-border text-success-text mb-4 flex items-center gap-2 border-b pb-4 text-sm">
        <Check aria-hidden className="size-4" />
        {t("all-caught-up")}
      </p>
    );
  }

  return (
    <div className="border-border mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b pb-4">
      <p className="text-muted-foreground text-sm">
        {t("review-summary", {
          amount: formatCurrency(review.totalAbs, review.currency),
          count: review.count,
        })}
      </p>
      <Link
        href="/accounts/transactions/review"
        className={buttonVariants({ size: "sm", variant: "secondary" })}
      >
        {t("review-now")}
      </Link>
    </div>
  );
}

export function LatestTransactionsSection({
  member = null,
}: {
  /** One member's transactions, or Shared's; null for everyone's. */
  member?: MemberFilter;
} = {}) {
  const t = useTranslations("homeOverview.latest");
  const memberKeys = memberKeysFor(member);
  const latest = useTransactions(
    memberKeys ? { ...LATEST, memberKeys } : LATEST,
  );

  if (latest.isPending) {
    return (
      <Section id="latest-heading" title={t("title")} busy>
        <RowsSkeleton rows={SHOWN} />
      </Section>
    );
  }

  if (latest.error) {
    return (
      <Section id="latest-heading" title={t("title")}>
        <DataLoadError
          error={latest.error}
          onRetry={() => void latest.refetch()}
        />
      </Section>
    );
  }

  // The API may return more than asked for; the section shows a fixed six.
  const transactions = latest.data.transactions.slice(0, SHOWN);
  // An offline account with only its opening balance has no real transaction (that row's key is
  // negative), so the review status stays out of it, exactly as for an empty account.
  const hasTransactions = transactions.some(
    (transaction) => transaction.transactionKey > 0,
  );

  if (transactions.length === 0) {
    return (
      <Section id="latest-heading" title={t("title")}>
        <SectionEmpty
          title={t("empty-title")}
          body={t("empty-body")}
          action={
            <Link
              href="/accounts"
              className={buttonVariants({ variant: "secondary" })}
            >
              {t("action")}
            </Link>
          }
        />
      </Section>
    );
  }

  return (
    <Section id="latest-heading" title={t("title")}>
      {hasTransactions ? <ReviewStatusRow /> : null}
      <table className="w-full border-collapse">
        <caption className="sr-only">
          {t("caption", { count: transactions.length })}
        </caption>
        <thead className="hidden md:table-header-group">
          <tr className="border-foreground text-muted-foreground border-b text-left text-xs">
            <th scope="col" className="pr-4 pb-2 font-medium">
              {t("date")}
            </th>
            <th scope="col" className="pr-4 pb-2 font-medium">
              {t("description")}
            </th>
            <th scope="col" className="pr-4 pb-2 font-medium">
              {t("category")}
            </th>
            <th scope="col" className="pb-2 text-right font-medium">
              {t("amount")}
            </th>
          </tr>
        </thead>
        <tbody className="grid md:table-row-group">
          {transactions.map((transaction) => (
            <TransactionRow
              key={transaction.transactionKey}
              transaction={transaction}
            />
          ))}
        </tbody>
      </table>
      <p className="mt-4">
        <Link
          href="/accounts/transactions"
          className={cn(buttonVariants({ variant: "link" }), "h-auto p-0")}
        >
          {t("all")}
        </Link>
      </p>
    </Section>
  );
}
