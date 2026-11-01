"use client";

import { subWeeks } from "date-fns";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import AccountTransactionAddModal from "@/components/account/AccountTransactionAddModal";
import AccountTransactionImportModal from "@/components/account/AccountTransactionImportModal";
import AccountTransactionsTable from "@/components/account/AccountTransactionsTable";
import CategoriesSpendingTable from "@/components/dashboard/CategoriesSpendingTable";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import DataLoadError from "@/components/ui/DataLoadError";
import { Link } from "@/components/ui/Link";
import { Spinner } from "@/components/ui/Spinner";
import { Heading, Text } from "@/components/ui/Typography";
import type { Account } from "@/lib/api/account/useAccounts";
import useTransactions from "@/lib/api/account/useTransactions";
import useTransactionsCategorySpending from "@/lib/api/account/useTransactionsCategorySpending";
import useConfigs from "@/lib/api/configs/useConfigs";
import { cn } from "@/lib/utils";

interface DashboardClientProps {
  hasFinancialData: boolean;
  accounts: Account[];
}

export function DashboardClient({
  hasFinancialData,
  accounts,
}: DashboardClientProps) {
  const t = useTranslations();
  const lastWeekStartDate = useMemo(() => subWeeks(new Date(), 1), []);
  const [isAddTransactionOpen, setIsAddTransactionOpen] = useState(false);
  const [isImportTransactionsOpen, setIsImportTransactionsOpen] =
    useState(false);

  const { data: configsData, isLoading: isLoadingConfigs } = useConfigs();

  const {
    data: transactionsData,
    isLoading: isLoadingTransactionsData,
    isError: isTransactionsError,
    error: transactionsError,
    refetch: refetchTransactions,
  } = useTransactions(
    {
      includeEmptyAccounts: true,
      fromDate: lastWeekStartDate,
    },
    {
      enabled: hasFinancialData,
    },
  );

  const {
    data: knownTransactionsData,
    isLoading: isLoadingKnownTransactionsData,
  } = useTransactions(
    {
      limit: 1,
    },
    {
      enabled: hasFinancialData,
    },
  );

  const unreviewedTransactionsData = useMemo(
    () =>
      transactionsData
        ? transactionsData.transactions.filter(
            (transaction) =>
              transaction.transactionKey > 0 && !transaction.reviewed,
          )
        : [],
    [transactionsData],
  );

  const recentRealTransactions = useMemo(
    () =>
      transactionsData?.transactions.filter(
        (transaction) => transaction.transactionKey > 0,
      ) ?? [],
    [transactionsData],
  );

  const {
    data: categoriesSpendingData,
    isLoading: isLoadingCategoriesSpendingData,
  } = useTransactionsCategorySpending(
    {
      limit: 5,
      fromDate: lastWeekStartDate,
    },
    {
      enabled: hasFinancialData,
    },
  );

  const categorySpendingRows = categoriesSpendingData?.categorySpending ?? [];
  const hasRecentRealTransactions = recentRealTransactions.length > 0;
  const hasKnownRealTransactions = Boolean(
    knownTransactionsData?.transactions.some(
      (transaction) => transaction.transactionKey > 0,
    ),
  );
  const hasCategorySpendingRows = categorySpendingRows.length > 0;
  const canOpenTransactionModals = accounts.length > 0;

  if (
    isLoadingConfigs ||
    isLoadingTransactionsData ||
    isLoadingKnownTransactionsData ||
    isLoadingCategoriesSpendingData
  ) {
    return <Spinner />;
  }

  return (
    <>
      {!!unreviewedTransactionsData.length && (
        <div
          aria-atomic="true"
          aria-live="polite"
          className="bg-card relative flex w-full flex-col justify-between gap-3 rounded-lg border p-4 md:flex-row md:items-center"
        >
          <div className="flex flex-col gap-1">
            <Heading variant="h6" className="text-sm md:text-base">
              {t("transaction-review-banner-title", {
                count: unreviewedTransactionsData.length,
              })}
            </Heading>
            <Text variant="mutedText">
              {t("transaction-review-banner-description")}
            </Text>
          </div>
          <Link
            href="/accounts/transactions/review"
            className={cn(buttonVariants({ variant: "default", size: "sm" }))}
          >
            {t("transaction-review-banner-cta")}
          </Link>
        </div>
      )}

      {!hasRecentRealTransactions && isTransactionsError ? (
        // A failed request must not render as "you have no transactions".
        <DataLoadError
          error={transactionsError}
          onRetry={() => void refetchTransactions()}
        />
      ) : !hasRecentRealTransactions ? (
        <Card className="border-border bg-card p-6">
          <div className="flex flex-col gap-5">
            <div className="space-y-2">
              <Heading variant="h4">
                {t(
                  hasKnownRealTransactions
                    ? "dashboard-no-recent-activity-title"
                    : "dashboard-add-first-transaction-title",
                )}
              </Heading>
              <Text variant="mutedText">
                {t(
                  hasKnownRealTransactions
                    ? "dashboard-no-recent-activity-description"
                    : "dashboard-add-first-transaction-description",
                )}
              </Text>
            </div>
            <div className="grid max-w-100 grid-cols-1 gap-3 sm:grid-cols-2">
              {canOpenTransactionModals ? (
                <Button
                  className="w-full"
                  onClick={() => setIsAddTransactionOpen(true)}
                >
                  {t("dashboard-add-transaction-action")}
                </Button>
              ) : (
                <Button asChild className="w-full">
                  <Link href="/accounts/transactions">
                    {t("dashboard-add-transaction-action")}
                  </Link>
                </Button>
              )}
              {canOpenTransactionModals ? (
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => setIsImportTransactionsOpen(true)}
                >
                  {t("dashboard-import-transactions-action")}
                </Button>
              ) : (
                <Button asChild className="w-full" variant="outline">
                  <Link href="/accounts/transactions">
                    {t("dashboard-import-transactions-action")}
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </Card>
      ) : (
        <>
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2 className="text-foreground text-sm font-medium">
                {t("last-week-top-categories")}
              </h2>
              {hasCategorySpendingRows ? (
                <Link
                  href="/accounts/transactions"
                  className={cn(
                    buttonVariants({ variant: "link" }),
                    "h-auto p-0",
                  )}
                >
                  {t("view-all")}
                </Link>
              ) : null}
            </div>
            {hasCategorySpendingRows ? (
              /* Same shell as the transactions panel below — one card, one
                 border, one radius. */
              <Card className="overflow-hidden">
                <CategoriesSpendingTable
                  categoriesSpending={categorySpendingRows}
                />
              </Card>
            ) : (
              <Card className="border-border bg-card p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <div className="space-y-2">
                    <Heading variant="h4">
                      {t("dashboard-categorize-transactions-title")}
                    </Heading>
                    <Text variant="mutedText">
                      {t("dashboard-categorize-transactions-description")}
                    </Text>
                  </div>
                  <Button asChild variant="outline" className="shrink-0">
                    <Link href="/accounts/transactions/review">
                      {t("transaction-review-banner-cta")}
                    </Link>
                  </Button>
                </div>
              </Card>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2 className="text-foreground text-sm font-medium">
                {t("last-week-transactions")}
              </h2>
              <Link
                href="/accounts/transactions"
                className={cn(
                  buttonVariants({ variant: "link" }),
                  "h-auto p-0",
                )}
              >
                {t("view-all")}
              </Link>
            </div>
            <Card className="overflow-hidden">
              <AccountTransactionsTable
                transactions={recentRealTransactions}
                categories={configsData?.categories ?? []}
                withAccountFilter={false}
                withFilters={false}
                withPagination={false}
                withRowActions={false}
                sticky={false}
              />
            </Card>
          </section>
        </>
      )}

      {canOpenTransactionModals && (
        <>
          <AccountTransactionAddModal
            isOpen={isAddTransactionOpen}
            setOpen={setIsAddTransactionOpen}
            accounts={accounts}
            trigger={null}
          />
          <AccountTransactionImportModal
            isOpen={isImportTransactionsOpen}
            setOpen={setIsImportTransactionsOpen}
            accounts={accounts}
            trigger={null}
          />
        </>
      )}
    </>
  );
}
