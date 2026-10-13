"use client";

import { MoveUpRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import AccountsFreshness from "@/components/account/AccountsFreshness";
import { SetupChecklistCard } from "@/components/activation/SetupChecklistCard";
import DashboardBudgetsEmptyState from "@/components/dashboard/DashboardBudgetsEmptyState";
import DashboardBudgetsTable from "@/components/dashboard/DashboardBudgetsTable";
import DashboardGoalsCard from "@/components/dashboard/DashboardGoalsCard";
import DashboardNetWorthBlock from "@/components/dashboard/DashboardNetWorthBlock";
import { NetWorthViewedEvent } from "@/components/dashboard/NetWorthViewedEvent";
import AppErrorState from "@/components/error/AppErrorState";
import Logo from "@/components/layout/Logo";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { SectionHeader } from "@/components/layout/SectionHeader";
import Welcome from "@/components/layout/Welcome";
import { DashboardOnboarding } from "@/components/onboarding/DashboardOnboarding";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import DataLoadError from "@/components/ui/DataLoadError";
import { Link } from "@/components/ui/Link";
import { hasActiveBankAccountSyncHandoff } from "@/lib/account/bank-account-sync-return-marker";
import useAccounts, {
  type Account,
  type GetAccountsResponse,
} from "@/lib/api/account/useAccounts";
import useTransactions, {
  type GetTransactionsResponse,
} from "@/lib/api/account/useTransactions";
import useBudgetsFull, {
  type GetBudgetsFullResponse,
} from "@/lib/api/budget/useBudgetsFull";
import useNetWorth from "@/lib/api/net-worth/useNetWorth";
import usePortfolios, {
  type GetPortfoliosResponse,
} from "@/lib/api/portfolio/usePortfolios";
import { RATE_LIMITED_ERROR_CODE } from "@/lib/api/rate-limit";
import { useUser } from "@/lib/auth/user-context";
import { getFirstRunState } from "@/lib/onboarding/firstRunOnboarding";
import { cn } from "@/lib/utils";
import { isValidFirstNetWorthState } from "@/lib/utils/analytics";

import { DashboardClient } from "./dashboard-client";

type HomeClientProps =
  | {
      initialDataStatus?: "available";
      initialAccountsData: GetAccountsResponse;
      initialPortfoliosData: GetPortfoliosResponse;
      initialBudgetsData: GetBudgetsFullResponse;
      initialTransactionsData: GetTransactionsResponse;
      initialUnreviewedTransactionsData: GetTransactionsResponse;
      initialErrorStatus?: never;
      initialRetryAfterSeconds?: never;
    }
  | {
      initialDataStatus: "unavailable";
      initialErrorStatus?: number;
      initialRetryAfterSeconds?: number;
      initialAccountsData?: never;
      initialPortfoliosData?: never;
      initialBudgetsData?: never;
      initialTransactionsData?: never;
      initialUnreviewedTransactionsData?: never;
    };

function getAccountSource(accounts: Account[]): "manual" | "sync" | undefined {
  if (!accounts.length) return undefined;

  return accounts.some((account) => account.source === "open_banking")
    ? "sync"
    : "manual";
}

function HomeUnavailableState({
  initialErrorStatus,
  initialRetryAfterSeconds,
}: {
  initialErrorStatus?: number;
  initialRetryAfterSeconds?: number;
}) {
  const router = useRouter();

  const error = new Error("Home SSR data unavailable") as Error & {
    response?: { status?: number; data?: unknown };
  };

  // Rebuilt as an API-shaped error so `classifyAppError` and the rate-limit
  // parser read it exactly as they read a live one. Server errors do not cross
  // the RSC boundary, so the envelope is reconstructed rather than forwarded.
  error.response = {
    status: initialErrorStatus,
    data:
      initialRetryAfterSeconds !== undefined
        ? {
            code: RATE_LIMITED_ERROR_CODE,
            retryAfter: initialRetryAfterSeconds,
          }
        : undefined,
  };

  return (
    <AppErrorState
      error={error}
      reset={() => router.refresh()}
      section="generic"
      className="py-0"
    />
  );
}

function HomeDashboardClient({
  initialAccountsData,
  initialPortfoliosData,
  initialBudgetsData,
  initialTransactionsData,
  initialUnreviewedTransactionsData,
}: Exclude<HomeClientProps, { initialDataStatus: "unavailable" }>) {
  const t = useTranslations();
  const user = useUser();

  const { data: accountsData } = useAccounts({
    initialData: initialAccountsData,
  });
  const { data: portfoliosData } = usePortfolios({
    initialData: initialPortfoliosData,
  });
  const {
    data: budgetsData,
    isError: isBudgetsError,
    error: budgetsError,
    refetch: refetchBudgets,
  } = useBudgetsFull({
    initialData: initialBudgetsData,
  });
  const { data: transactionsData } = useTransactions(
    { includeEmptyAccounts: true, limit: 1 },
    { initialData: initialTransactionsData },
  );
  const { data: unreviewedTransactionsData } = useTransactions(
    { includeEmptyAccounts: true, limit: 1, unreviewedOnly: true },
    { initialData: initialUnreviewedTransactionsData },
  );
  const {
    data: netWorthData,
    isLoading: isNetWorthLoading,
    isError: isNetWorthError,
    error: netWorthError,
    refetch: refetchNetWorth,
  } = useNetWorth();

  const hasFinancialData =
    Boolean(accountsData?.accounts?.length) ||
    Boolean(portfoliosData?.portfolios?.length);
  const accountCount = accountsData?.accounts?.length ?? 0;
  const portfolioCount = portfoliosData?.portfolios?.length ?? 0;
  const budgets = budgetsData?.budgets ?? [];
  const budgetCount = budgets.length;
  const hasBudgets = budgetCount > 0;
  const accountSource = getAccountSource(accountsData?.accounts ?? []);

  const totalNetWorth = netWorthData?.netWorth.netWorth;
  const hasValidNetWorthPayload =
    typeof totalNetWorth === "number" && Number.isFinite(totalNetWorth);
  const firstNetWorthVisible = isValidFirstNetWorthState({
    accountCount,
    isLoaded: hasValidNetWorthPayload && !isNetWorthLoading && !isNetWorthError,
    portfolioCount,
  });

  if (!hasFinancialData) {
    return (
      <>
        <NetWorthViewedEvent
          accountCount={accountCount}
          accountSource={accountSource}
          portfolioCount={portfolioCount}
          isLoaded={false}
          captureLegacyNetWorthViewed={false}
        />
        <Welcome />
      </>
    );
  }

  const hasTransactions = Boolean(transactionsData?.transactions?.length);
  const hasReviewedTransactions =
    hasTransactions &&
    !Boolean(unreviewedTransactionsData?.transactions?.length);

  return (
    <PageShell>
      <NetWorthViewedEvent
        accountCount={accountCount}
        accountSource={accountSource}
        portfolioCount={portfolioCount}
        isLoaded={firstNetWorthVisible}
      />
      <div className="md:hidden">
        <Logo className="h-10 w-28" />
      </div>
      <PageHeader
        title={t("at-glance")}
        badge={<DashboardOnboarding />}
        // § 9 rule 6: the dashboard aggregates balances from every account, so
        // it is exactly where a stale connection is least visible.
        provenance={<AccountsFreshness accounts={accountsData?.accounts} />}
      />

      <SetupChecklistCard
        hasAccount={Boolean(accountsData?.accounts?.length)}
        hasReviewedTransactions={hasReviewedTransactions}
        hasBudget={hasBudgets}
        hasPortfolio={Boolean(portfoliosData?.portfolios?.length)}
      />

      <section className="flex flex-col gap-2">
        <DashboardNetWorthBlock
          netWorth={netWorthData?.netWorth}
          isLoading={isNetWorthLoading}
          isError={isNetWorthError}
          error={netWorthError}
          onRetry={() => void refetchNetWorth()}
        />
      </section>

      <section className="flex flex-col gap-2">
        <SectionHeader
          title={t("budgets")}
          actions={
            hasBudgets ? (
              <Link
                href="/budgets"
                className={cn(
                  buttonVariants({ variant: "link" }),
                  "h-auto p-0",
                )}
              >
                {t("view-all")}{" "}
                <MoveUpRight strokeWidth={2} className="ml-1 size-4" />
              </Link>
            ) : undefined
          }
        />
        {hasBudgets ? (
          <Card className="border-none">
            <DashboardBudgetsTable budgets={budgets} />
          </Card>
        ) : isBudgetsError ? (
          // Don't show the "no budgets yet" onboarding state for a failed load.
          <DataLoadError
            error={budgetsError}
            onRetry={() => void refetchBudgets()}
          />
        ) : (
          <DashboardBudgetsEmptyState />
        )}
      </section>

      <DashboardGoalsCard />

      <DashboardClient
        hasFinancialData={hasFinancialData}
        accounts={accountsData?.accounts ?? []}
      />
    </PageShell>
  );
}

export function HomeClient(props: HomeClientProps) {
  if (props.initialDataStatus === "unavailable") {
    return (
      <HomeUnavailableState
        initialErrorStatus={props.initialErrorStatus}
        initialRetryAfterSeconds={props.initialRetryAfterSeconds}
      />
    );
  }

  return <HomeDashboardClient {...props} />;
}
