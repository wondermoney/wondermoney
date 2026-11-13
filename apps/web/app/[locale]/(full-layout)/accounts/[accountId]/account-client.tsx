"use client";

import { startOfDay, subDays } from "date-fns";
import { Eye, Lock, Plus, Upload, Users } from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useMemo, useState } from "react";
import { DateRange } from "react-day-picker";

import { accountDisplayBalance } from "@/components/account/AccountBalance";
import AccountForecastCallout from "@/components/account/AccountForecastCallout";
import AccountTransactionAddModal from "@/components/account/AccountTransactionAddModal";
import AccountTransactionImportModal from "@/components/account/AccountTransactionImportModal";
import AccountTransactionsTable from "@/components/account/AccountTransactionsTable";
import CreditCardStatements from "@/components/account/CreditCardStatements";
import CreditCardStatementSummary from "@/components/account/CreditCardStatementSummary";
import MetricsCards from "@/components/account/MetricsCards";
import ProjectedTransactions from "@/components/account/ProjectedTransactions";
import { clampSyncedAt } from "@/components/account/sync-time";
import CardInstallments from "@/components/installments/CardInstallments";
import { Button } from "@/components/ui/button";
import { DataProvenance } from "@/components/ui/DataProvenance";
import { FxStatusBadge } from "@/components/ui/FxStatusBadge";
import { Link } from "@/components/ui/Link";
import { ObjectHeader } from "@/components/ui/ObjectHeader";
import { Section } from "@/components/ui/RuledSection";
import { Spinner } from "@/components/ui/Spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  canEditAccount,
  readOnlyAccountKeys,
} from "@/lib/account/account-access";
import type { GetAccountResponse } from "@/lib/api/account/useAccount";
import useAccount from "@/lib/api/account/useAccount";
import type { GetAccountForecastResponse } from "@/lib/api/account/useAccountForecast";
import useAccountForecast from "@/lib/api/account/useAccountForecast";
import type { GetAccountMetricsResponse } from "@/lib/api/account/useAccountMetrics";
import useAccountMetrics from "@/lib/api/account/useAccountMetrics";
import type { GetAccountsResponse } from "@/lib/api/account/useAccounts";
import useAccounts from "@/lib/api/account/useAccounts";
import type { GetAccountTransactionsResponse } from "@/lib/api/account/useAccountTransactions";
import useAccountTransactions from "@/lib/api/account/useAccountTransactions";
import type { GetConfigsResponse } from "@/lib/api/configs/useConfigs";
import useConfigs from "@/lib/api/configs/useConfigs";
import { accountFxView } from "@/lib/fx/fx-status";
import { serverSeed } from "@/lib/query/server-seed";

// Code-split heavy chart component
const AccountTransactionsChart = dynamic(
  () => import("@/components/account/AccountTransactionsChart"),
  { loading: () => <Spinner /> },
);

// ---------- Main Component ----------

interface AccountClientProps {
  accountId: number;
  serverRenderedAt: number;
  initialAccountData: GetAccountResponse;
  initialAccountsData: GetAccountsResponse;
  initialTransactionsData: GetAccountTransactionsResponse;
  initialConfigsData: GetConfigsResponse;
  initialAccountMetricsData: GetAccountMetricsResponse;
  initialForecastData: GetAccountForecastResponse;
  /** `?tab=statements` opens a credit card's statements tab (the reminder email links there). */
  initialTab?: string;
}

export default function AccountClient({
  accountId,
  serverRenderedAt,
  initialAccountData,
  initialAccountsData,
  initialTransactionsData,
  initialConfigsData,
  initialAccountMetricsData,
  initialForecastData,
  initialTab,
}: AccountClientProps) {
  const t = useTranslations();
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

  const forecastDays = 30;
  const { data: forecastData } = useAccountForecast(
    { accountKeys: [accountId], days: forecastDays },
    {
      enabled: !!accountId && !Number.isNaN(accountId),
      ...serverSeed(initialForecastData, serverRenderedAt),
    },
  );
  const accountForecast =
    forecastData?.accounts.find((series) => series.accountKey === accountId) ??
    null;

  // Table stuff
  const [transactionDateRange, setTransactionDateRange] = useState<
    DateRange | undefined
  >({ from: startOfDay(subDays(new Date(), 60)), to: startOfDay(new Date()) });

  // A credit card's page splits into Overview and Statements; the reminder email links straight
  // to the statements tab.
  const [activeTab, setActiveTab] = useState(
    initialTab === "statements" ? "statements" : "overview",
  );

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
  // Shared to view only (or a household viewer): the page shows everything and changes nothing.
  const canEdit = canEditAccount(account);
  // `?? t("unknown")` printed "Unknown" under the title of every manual
  // account — a placeholder posing as a fact about the bank. A manual account
  // has no institution; the honest rendering is no line at all. § 9 rule 4.
  const institutionName =
    account.accountFinancialInstitutionKey?.displayName ?? null;
  // With no exchange rate the balance is shown in the account's own currency,
  // marked "Not converted", and there is no second figure to show.
  const fx = accountFxView(account);
  const isMultiCurrency =
    account.accountOwnerAppuserKey.currencyKey.code !==
      account.currencyKey.code && fx.status !== "missing";
  const currency = account.accountOwnerAppuserKey.currencyKey.code;
  const { value: primaryBalance, currency: balanceCurrency } = isMultiCurrency
    ? accountDisplayBalance(account)
    : { value: account.balance, currency: account.currencyKey.code };

  const overviewSections = (
    <>
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
            userCurrency={currency}
          />
        ) : (
          <p className="text-muted-foreground text-sm">{t("no-metrics")}</p>
        )}
      </section>

      {/* Credit card statement */}
      {account.creditCard ? (
        <CreditCardStatementSummary
          accountKey={account.accountKey}
          creditCard={account.creditCard}
          currency={account.currencyKey.code}
        />
      ) : null}

      {/* A card's purchases in installments: what is still to be charged, its plans and the
          rows that look like one. */}
      {account.creditCard ? (
        <CardInstallments
          accountKey={account.accountKey}
          currency={account.currencyKey.code}
          categories={configsData?.categories ?? []}
          readOnly={!canEdit}
        />
      ) : null}

      {/* Balance chart */}
      <Section id="balance-growth-heading" title={t("balance-growth")}>
        <div>
          {isLoadingTransactionsData && !isTransactionsPlaceholderData ? (
            <div className="flex h-75 items-center justify-center">
              <Spinner />
            </div>
          ) : transactionsData?.transactions &&
            transactionsData.transactions.length > 0 ? (
            <>
              <AccountTransactionsChart
                currencyCode={currency}
                forecast={
                  accountForecast
                    ? {
                        currency: accountForecast.currency,
                        points: accountForecast.points,
                      }
                    : null
                }
                transactions={transactionsData.transactions}
              />
              {accountForecast ? (
                <div className="mt-4">
                  <AccountForecastCallout
                    days={forecastDays}
                    series={accountForecast}
                  />
                </div>
              ) : null}
            </>
          ) : (
            <div className="flex h-50 flex-col items-center justify-center gap-3 px-5 text-center">
              <p className="text-muted-foreground text-sm">
                {t("empty-transactions-description")}
              </p>
            </div>
          )}
        </div>
      </Section>

      {/* Recent transactions */}
      <Section
        id="last-transactions-heading"
        title={t("last-transactions")}
        aside={
          <Link
            href={`/accounts/${accountId}/transactions`}
            className="text-primary text-sm font-medium no-underline hover:underline"
          >
            {t("view-all")}
          </Link>
        }
      >
        <div>
          {isLoading ? (
            <div className="flex h-50 items-center justify-center">
              <Spinner />
            </div>
          ) : transactionsData?.transactions &&
            transactionsData.transactions.length > 0 ? (
            <div className="flex flex-col gap-4">
              <ProjectedTransactions
                occurrences={accountForecast?.projected ?? []}
                installments={accountForecast?.projectedInstallments ?? []}
              />
              <AccountTransactionsTable
                layout="ledger"
                transactions={transactionsForTable ?? []}
                categories={configsData?.categories ?? []}
                withAccountFilter={false}
                withFilters={false}
                withPagination={false}
                sticky={false}
                readOnlyAccountKeys={readOnlyAccountKeys([account])}
                transactionDateRange={transactionDateRange}
                setTransactionDateRange={(dataRange) =>
                  setTransactionDateRange(dataRange)
                }
              />
            </div>
          ) : (
            <div className="flex h-50 flex-col items-center justify-center gap-3 px-5 text-center">
              <p className="text-muted-foreground text-sm">
                {t("empty-transactions-description")}
              </p>
              {canEdit ? (
                <Button onClick={openAddManualTransactionModal}>
                  <Plus className="size-4" />
                  {t("add-transaction")}
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </Section>
    </>
  );

  const isCreditCard = Boolean(account.creditCard);

  return (
    <div className="flex flex-col gap-10 lg:gap-12">
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
            {!canEdit && (
              <span className="text-muted-foreground border-border flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
                <Eye className="size-3" />
                {t("accountSharing.view-only")}
              </span>
            )}
            {!account.isOwnedByViewer && account.ownerFirstName && (
              <span className="text-muted-foreground flex items-center gap-1 text-xs">
                <Users className="size-3" />
                {t("shared-by", { name: account.ownerFirstName })}
              </span>
            )}
            <FxStatusBadge
              view={fx}
              originalCurrency={account.currencyKey.code}
            />
          </>
        }
        value={primaryBalance}
        currency={balanceCurrency}
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
          transactionAccount && canEdit ? (
            <>
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
                  <Button variant="outline" className="w-full sm:w-auto">
                    <Upload className="size-4" />
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
                  <Button className="w-full sm:w-auto">
                    <Plus className="size-4" />
                    {t("add-transaction")}
                  </Button>
                }
              />
            </>
          ) : null
        }
      />

      {isCreditCard ? (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="self-start">
            <TabsTrigger value="overview">
              {t("credit-card-overview")}
            </TabsTrigger>
            <TabsTrigger value="statements">
              {t("credit-card-statements")}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="overview">
            <div className="flex flex-col gap-10 lg:gap-12">
              {overviewSections}
            </div>
          </TabsContent>
          <TabsContent value="statements">
            <CreditCardStatements
              accountKey={account.accountKey}
              currency={account.currencyKey.code}
            />
          </TabsContent>
        </Tabs>
      ) : (
        overviewSections
      )}
    </div>
  );
}
