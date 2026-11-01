"use client";

import { startOfDay, subDays } from "date-fns";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Lock,
  MoveUpRight,
  PiggyBank,
  Plus,
  TrendingDown,
  TrendingUp,
  Upload,
  Users,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useMemo, useState } from "react";
import { DateRange } from "react-day-picker";

import AccountTransactionAddModal from "@/components/account/AccountTransactionAddModal";
import AccountTransactionImportModal from "@/components/account/AccountTransactionImportModal";
import AccountTransactionsTable from "@/components/account/AccountTransactionsTable";
import { clampSyncedAt } from "@/components/account/sync-time";
import { Amount } from "@/components/ui/Amount";
import { Button } from "@/components/ui/button";
import { DataProvenance } from "@/components/ui/DataProvenance";
import { Link } from "@/components/ui/Link";
import { ObjectHeader } from "@/components/ui/ObjectHeader";
import { Spinner } from "@/components/ui/Spinner";
import type { GetAccountResponse } from "@/lib/api/account/useAccount";
import useAccount from "@/lib/api/account/useAccount";
import type { AccountMetrics } from "@/lib/api/account/useAccountMetrics";
import type { GetAccountMetricsResponse } from "@/lib/api/account/useAccountMetrics";
import useAccountMetrics from "@/lib/api/account/useAccountMetrics";
import type { GetAccountsResponse } from "@/lib/api/account/useAccounts";
import useAccounts from "@/lib/api/account/useAccounts";
import type { GetAccountTransactionsResponse } from "@/lib/api/account/useAccountTransactions";
import useAccountTransactions from "@/lib/api/account/useAccountTransactions";
import type { GetConfigsResponse } from "@/lib/api/configs/useConfigs";
import useConfigs from "@/lib/api/configs/useConfigs";
import { serverSeed } from "@/lib/query/server-seed";
import { cn } from "@/lib/utils";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";
import { useFormatPercentage } from "@/lib/utils/useFormatPercentage";

// Code-split heavy chart component
const AccountTransactionsChart = dynamic(
  () => import("@/components/account/AccountTransactionsChart"),
  { loading: () => <Spinner /> },
);

// ---------- Helper: aggregate metrics ----------

function aggregateMetrics(metrics: AccountMetrics[]) {
  const agg = metrics.reduce(
    (acc, cur) => ({
      inflowCurrent: acc.inflowCurrent + cur.inflowCurrentPeriod,
      inflowPast: acc.inflowPast + cur.inflowPastPeriod,
      inflowDelta: acc.inflowDelta + cur.inflowDelta,
      outflowCurrent: acc.outflowCurrent + cur.outflowCurrentPeriod,
      outflowPast: acc.outflowPast + cur.outflowPastPeriod,
      outflowDelta: acc.outflowDelta + cur.outflowDelta,
    }),
    {
      inflowCurrent: 0,
      inflowPast: 0,
      inflowDelta: 0,
      outflowCurrent: 0,
      outflowPast: 0,
      outflowDelta: 0,
    },
  );

  const inflowPct =
    agg.inflowPast === 0
      ? agg.inflowCurrent > 0
        ? Infinity
        : 0
      : (agg.inflowCurrent - agg.inflowPast) / agg.inflowPast;
  const outflowPct =
    agg.outflowPast === 0
      ? agg.outflowCurrent > 0
        ? Infinity
        : 0
      : (agg.outflowCurrent - agg.outflowPast) / agg.outflowPast;

  return { ...agg, inflowPct, outflowPct };
}

// ---------- Metrics Cards ----------

function MetricsCards({
  metrics,
  currency,
}: {
  metrics: AccountMetrics[];
  currency: string;
}) {
  const t = useTranslations();
  const formatPercentage = useFormatPercentage();
  const formatCurrency = useFormatCurrency();
  const agg = aggregateMetrics(metrics);

  const netSavings = agg.inflowCurrent - agg.outflowCurrent;
  const savingsRate =
    agg.inflowCurrent > 0 ? netSavings / agg.inflowCurrent : 0;

  const cards = [
    {
      icon: ArrowDownLeft,
      label: t("inflow"),
      value: agg.inflowCurrent,
      delta: agg.inflowDelta,
      pct: agg.inflowPct,
      positiveIsGood: true,
      isSavingsRate: false,
    },
    {
      icon: ArrowUpRight,
      label: t("outflow"),
      value: agg.outflowCurrent,
      delta: agg.outflowDelta,
      pct: agg.outflowPct,
      positiveIsGood: false,
      isSavingsRate: false,
    },
    {
      icon: PiggyBank,
      label: t("savings-rate"),
      value: netSavings,
      delta: 0,
      pct: savingsRate,
      positiveIsGood: true,
      isSavingsRate: true,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {cards.map((card) => {
        const isPositive = card.delta > 0;
        const isNeutral = card.delta === 0 && !card.isSavingsRate;
        const isGoodTrend = card.isSavingsRate
          ? netSavings >= 0
          : card.positiveIsGood
            ? isPositive
            : !isPositive;
        const trendColor = isNeutral
          ? "text-muted-foreground"
          : isGoodTrend
            ? "text-success-text"
            : "text-destructive-text";
        const TrendIcon = isPositive ? TrendingUp : TrendingDown;

        return (
          <div
            key={card.label}
            className="border-border bg-card rounded-lg border p-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <card.icon className="text-muted-foreground h-3.5 w-3.5" />
                <span className="text-muted-foreground text-sm">
                  {card.label}
                </span>
              </div>
              {card.isSavingsRate ? (
                <span
                  className={cn(
                    "text-xs font-medium",
                    netSavings >= 0
                      ? "text-success-text"
                      : "text-destructive-text",
                  )}
                >
                  {formatPercentage(Math.abs(savingsRate))}
                </span>
              ) : (
                !isNeutral && (
                  <div className="flex items-center gap-1">
                    <TrendIcon className={cn("h-3 w-3", trendColor)} />
                    {card.pct !== null && isFinite(card.pct) && (
                      <span className={cn("text-xs font-medium", trendColor)}>
                        {formatPercentage(Math.abs(card.pct))}
                      </span>
                    )}
                  </div>
                )
              )}
            </div>
            <p className="text-foreground mt-2 font-mono text-xl font-semibold tracking-tight">
              <Amount value={card.value} currency={currency} />
            </p>
            {card.isSavingsRate && (
              <p className="text-muted-foreground mt-0.5 text-xs">
                {t("net-savings")}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- Main Component ----------

interface AccountClientProps {
  accountId: number;
  serverRenderedAt: number;
  initialAccountData: GetAccountResponse;
  initialAccountsData: GetAccountsResponse;
  initialTransactionsData: GetAccountTransactionsResponse;
  initialConfigsData: GetConfigsResponse;
  initialAccountMetricsData: GetAccountMetricsResponse;
}

export default function AccountClient({
  accountId,
  serverRenderedAt,
  initialAccountData,
  initialAccountsData,
  initialTransactionsData,
  initialConfigsData,
  initialAccountMetricsData,
}: AccountClientProps) {
  const t = useTranslations();
  const formatPercentage = useFormatPercentage();
  const posthog = usePostHog();

  const { data: accountsData, isLoading: isLoadingAccountsData } = useAccount(
    accountId,
    serverSeed(initialAccountData, serverRenderedAt),
  );
  const { data: accountsListData, isLoading: isLoadingAccountsList } =
    useAccounts(serverSeed(initialAccountsData, serverRenderedAt));

  const {
    data: transactionsData,
    isLoading: isLoadingTransactionsData,
    isPlaceholderData: isTransactionsPlaceholderData,
  } = useAccountTransactions(
    { accountId },
    {
      enabled: !!accountId && !Number.isNaN(accountId),
      ...serverSeed(initialTransactionsData, serverRenderedAt),
    },
  );

  const transactionsForTable = useMemo(
    () => transactionsData?.transactions.slice(0, 5),
    [transactionsData?.transactions],
  );

  const { data: configsData, isLoading: isLoadingConfigs } = useConfigs(
    serverSeed(initialConfigsData, serverRenderedAt),
  );

  const isLoading = isLoadingTransactionsData || isLoadingConfigs;

  const {
    data: accountMetricsData,
    isLoading: isLoadingAccountMetricsData,
    isPlaceholderData: isAccountMetricsPlaceholderData,
  } = useAccountMetrics(accountId, {
    enabled: !!accountId && !Number.isNaN(accountId),
    ...serverSeed(initialAccountMetricsData, serverRenderedAt),
  });

  // Table stuff
  const [transactionDateRange, setTransactionDateRange] = useState<
    DateRange | undefined
  >({ from: startOfDay(subDays(new Date(), 60)), to: startOfDay(new Date()) });

  // Add manual transaction modal
  const [isAddManualTransactionModalOpen, setIsAddManualTransactionOpen] =
    useState(false);
  const openAddManualTransactionModal = () => {
    setIsAddManualTransactionOpen(true);
    posthog.capture("account_transaction_table_add_manual_transaction", {
      action: "open",
    });
  };
  const closeAddManualTransactionModal = () => {
    setIsAddManualTransactionOpen(false);
    posthog.capture("account_transaction_table_add_manual_transaction", {
      action: "close",
    });
  };

  // Import transaction modal
  const [isImportTransactionModalOpen, setIsImportTransactionModalOpen] =
    useState(false);
  const openImportTransactionModal = () => {
    setIsImportTransactionModalOpen(true);
    posthog.capture("account_transaction_table_import_transaction", {
      action: "open",
    });
  };
  const closeImportTransactionModal = () => {
    setIsImportTransactionModalOpen(false);
    posthog.capture("account_transaction_table_import_transaction", {
      action: "close",
    });
  };

  if (isLoadingAccountsData || isLoadingAccountsList) {
    return <Spinner />;
  }

  const account = accountsData!.account;
  const transactionAccount = accountsListData?.accounts.find(
    (candidate) => candidate.accountKey === account.accountKey,
  );
  const accountName = account.accountName ?? t("unknown");
  // `?? t("unknown")` printed "Unknown" under the title of every manual
  // account — a placeholder posing as a fact about the bank. A manual account
  // has no institution; the honest rendering is no line at all. § 9 rule 4.
  const institutionName =
    account.accountFinancialInstitutionKey?.displayName ?? null;
  const currency = account.accountOwnerAppuserKey.currencyKey.code;
  const isMultiCurrency =
    account.accountOwnerAppuserKey.currencyKey.code !==
    account.currencyKey.code;
  const primaryBalance = isMultiCurrency
    ? account.appuserCurrencyBalance
    : account.balance;

  return (
    <div className="flex flex-col gap-6">
      {/* One header for the object, replacing a name-only header plus a
          separate "Account balance" card below it — the figure a person opens
          this page to see was the third thing on it, boxed on its own.
          § 9 ObjectHeader. */}
      <ObjectHeader
        backHref="/accounts"
        backLabel={t("accounts")}
        title={accountName}
        subtitle={institutionName}
        badges={
          <>
            {account.isPrivate && (
              <span className="text-muted-foreground border-border flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
                <Lock className="size-3" />
                {t("account-private")}
              </span>
            )}
            {!account.isOwnedByViewer && account.ownerFirstName && (
              <span className="text-muted-foreground flex items-center gap-1 text-xs">
                <Users className="size-3" />
                {t("shared-by", { name: account.ownerFirstName })}
              </span>
            )}
          </>
        }
        value={primaryBalance}
        currency={currency}
        valueLabel={t("account-balance")}
        secondaryValue={isMultiCurrency ? account.balance : undefined}
        secondaryCurrency={account.currencyKey.code}
        provenance={
          <DataProvenance
            updatedAt={clampSyncedAt(
              account.syncStatus?.lastSyncedAt ?? account.refreshedAt,
            )}
            isStale={
              account.syncStatus?.staleness === "stale" ||
              account.syncStatus?.staleness === "very_stale"
            }
            label={(time) => t("provenance-balances-updated", { time })}
          />
        }
        actions={
          transactionAccount ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <AccountTransactionImportModal
                isOpen={isImportTransactionModalOpen}
                setOpen={(open) => {
                  if (!open) {
                    closeImportTransactionModal();
                  } else {
                    openImportTransactionModal();
                  }
                }}
                accounts={[transactionAccount]}
                trigger={
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-1.5 sm:w-auto"
                  >
                    <Upload className="size-3.5" />
                    {t("import-transactions")}
                  </Button>
                }
              />
              <AccountTransactionAddModal
                isOpen={isAddManualTransactionModalOpen}
                setOpen={(open) => {
                  if (!open) {
                    closeAddManualTransactionModal();
                  } else {
                    openAddManualTransactionModal();
                  }
                }}
                accounts={[transactionAccount]}
                trigger={
                  <Button size="sm" className="w-full gap-1.5 sm:w-auto">
                    <Plus className="size-3.5" />
                    {t("add-transaction")}
                  </Button>
                }
              />
            </div>
          ) : null
        }
      />

      {/* Metrics */}
      <section>
        {isLoadingAccountMetricsData && !isAccountMetricsPlaceholderData ? (
          <div className="flex h-24 items-center justify-center">
            <Spinner />
          </div>
        ) : accountMetricsData?.metrics &&
          accountMetricsData.metrics.length > 0 ? (
          <MetricsCards
            metrics={accountMetricsData.metrics}
            currency={currency}
          />
        ) : (
          <div className="border-border bg-card rounded-lg border px-4 py-8 text-center">
            <p className="text-muted-foreground text-sm">{t("no-metrics")}</p>
          </div>
        )}
      </section>

      {/* Balance chart */}
      <section className="border-border bg-card rounded-lg border">
        <div className="border-border border-b px-5 py-3">
          <h2 className="text-foreground text-sm font-medium">
            {t("balance-growth")}
          </h2>
        </div>
        <div className="p-5">
          {isLoadingTransactionsData && !isTransactionsPlaceholderData ? (
            <div className="flex h-75 items-center justify-center">
              <Spinner />
            </div>
          ) : transactionsData?.transactions &&
            transactionsData.transactions.length > 0 ? (
            <AccountTransactionsChart
              currencyCode={currency}
              transactions={transactionsData.transactions}
            />
          ) : (
            <div className="flex h-50 flex-col items-center justify-center gap-3 px-5 text-center">
              <p className="text-muted-foreground text-sm">
                {t("empty-transactions-description")}
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Recent transactions */}
      <section className="border-border bg-card rounded-lg border">
        <div className="border-border flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-foreground text-sm font-medium">
            {t("last-transactions")}
          </h2>
          <Link
            href={`/accounts/${accountId}/transactions`}
            className="text-primary text-xs font-medium no-underline hover:underline"
          >
            {t("view-all")}{" "}
            <MoveUpRight strokeWidth={2} className="ml-0.5 inline size-3" />
          </Link>
        </div>
        <div className="p-0">
          {isLoading ? (
            <div className="flex h-50 items-center justify-center">
              <Spinner />
            </div>
          ) : transactionsData?.transactions &&
            transactionsData.transactions.length > 0 ? (
            <AccountTransactionsTable
              transactions={transactionsForTable ?? []}
              categories={configsData?.categories ?? []}
              withAccountFilter={false}
              withFilters={false}
              withPagination={false}
              sticky={false}
              transactionDateRange={transactionDateRange}
              setTransactionDateRange={(dataRange) =>
                setTransactionDateRange(dataRange)
              }
            />
          ) : (
            <div className="flex h-50 flex-col items-center justify-center gap-3 px-5 text-center">
              <p className="text-muted-foreground text-sm">
                {t("empty-transactions-description")}
              </p>
              <Button
                size="sm"
                className="gap-1.5"
                onClick={openAddManualTransactionModal}
              >
                <Plus className="size-3.5" />
                {t("add-transaction")}
              </Button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
