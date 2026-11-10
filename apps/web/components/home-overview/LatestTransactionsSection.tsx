"use client";

import { useTranslations } from "next-intl";

import { Amount } from "@/components/ui/Amount";
import { buttonVariants } from "@/components/ui/button";
import DataLoadError from "@/components/ui/DataLoadError";
import { Link } from "@/components/ui/Link";
import {
  RowsSkeleton,
  Section,
  SectionEmpty,
} from "@/components/ui/RuledSection";
import useTransactions, {
  type Transaction,
} from "@/lib/api/account/useTransactions";
import { cn } from "@/lib/utils";
import { getCategoryDisplayName } from "@/lib/utils/categories";
import { transactionDisplayDate } from "@/lib/utils/transaction-date";
import { useFormatShortDate } from "@/lib/utils/useFormatShortDate";

const SHOWN = 6;
const LATEST = { limit: SHOWN } as const;
const UNREVIEWED = { limit: 1, unreviewedOnly: true } as const;

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
        <Amount
          value={transaction.appuserSettlementAmount}
          currency={transaction.appuserCurrencyKey.code}
          signed
          className="font-mono text-sm md:text-base"
        />
      </td>
    </tr>
  );
}

export function LatestTransactionsSection() {
  const t = useTranslations("homeOverview.latest");
  const latest = useTransactions(LATEST);
  const unreviewed = useTransactions(UNREVIEWED);
  const unreviewedCount =
    unreviewed.data?.total ?? unreviewed.data?.transactions.length;

  const reviewLink =
    unreviewedCount && unreviewedCount > 0 ? (
      <Link
        href="/accounts/transactions/review"
        className={cn(buttonVariants({ variant: "link" }), "h-auto p-0")}
      >
        {t("review", { count: unreviewedCount })}
      </Link>
    ) : undefined;

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
    <Section id="latest-heading" title={t("title")} aside={reviewLink}>
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
