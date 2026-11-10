"use client";

import { SetupChecklistCard } from "@/components/activation/SetupChecklistCard";
import { NetWorthViewedEvent } from "@/components/dashboard/NetWorthViewedEvent";
import useAccounts, { type Account } from "@/lib/api/account/useAccounts";
import useTransactions from "@/lib/api/account/useTransactions";
import useBudgetsFull from "@/lib/api/budget/useBudgetsFull";
import useNetWorth from "@/lib/api/net-worth/useNetWorth";
import usePortfolios from "@/lib/api/portfolio/usePortfolios";
import { isValidFirstNetWorthState } from "@/lib/utils/analytics";
import { useHydrated } from "@/lib/utils/useHydrated";

import { BalanceSheetSection } from "./BalanceSheetSection";
import { BankAlertsBanner } from "./BankAlertsBanner";
import { CashflowSection } from "./CashflowSection";
import { LatestTransactionsSection } from "./LatestTransactionsSection";
import { LoansSection } from "./LoansSection";
import { NetWorthHero } from "./NetWorthHero";
import { ThisMonthSection } from "./ThisMonthSection";

const ANY_TRANSACTION = { includeEmptyAccounts: true, limit: 1 } as const;
const ANY_UNREVIEWED = {
  includeEmptyAccounts: true,
  limit: 1,
  unreviewedOnly: true,
} as const;

function accountSource(accounts: Account[]): "manual" | "sync" | undefined {
  if (!accounts.length) return undefined;
  return accounts.some((account) => account.source === "open_banking")
    ? "sync"
    : "manual";
}

/**
 * The activation checklist and the `net_worth_viewed` / first-dashboard-view
 * analytics the previous home sent, carried over unchanged.
 */
function HomeActivation() {
  const { data: accountsData, isSuccess: accountsLoaded } = useAccounts();
  const { data: portfoliosData, isSuccess: portfoliosLoaded } = usePortfolios();
  const { data: budgetsData } = useBudgetsFull();
  const { data: anyTransaction } = useTransactions(ANY_TRANSACTION);
  const { data: anyUnreviewed } = useTransactions(ANY_UNREVIEWED);
  const netWorth = useNetWorth();

  const accounts = accountsData?.accounts ?? [];
  const accountCount = accounts.length;
  const portfolioCount = portfoliosData?.portfolios?.length ?? 0;
  const hasTransactions = Boolean(anyTransaction?.transactions?.length);
  const totalNetWorth = netWorth.data?.netWorth.netWorth;
  const netWorthLoaded =
    typeof totalNetWorth === "number" &&
    Number.isFinite(totalNetWorth) &&
    !netWorth.isLoading &&
    !netWorth.isError;
  const hasFinancialData = accountCount > 0 || portfolioCount > 0;

  return (
    <>
      {accountsLoaded && portfoliosLoaded ? (
        <NetWorthViewedEvent
          accountCount={accountCount}
          accountSource={accountSource(accounts)}
          portfolioCount={portfolioCount}
          isLoaded={
            hasFinancialData &&
            isValidFirstNetWorthState({
              accountCount,
              isLoaded: netWorthLoaded,
              portfolioCount,
            })
          }
          captureLegacyNetWorthViewed={hasFinancialData}
        />
      ) : null}
      {accountsLoaded ? (
        <SetupChecklistCard
          hasAccount={accountCount > 0}
          hasReviewedTransactions={
            hasTransactions && !anyUnreviewed?.transactions?.length
          }
          hasBudget={Boolean(budgetsData?.budgets.length)}
          hasPortfolio={portfolioCount > 0}
        />
      ) : null}
    </>
  );
}

/**
 * The home screen. Net worth leads, with its trend, because it is the one
 * figure that sums up the household; every budget's month follows as a
 * compact row each, then the balance sheet behind the figure, cash flow and
 * loans, and the latest transactions close the page.
 */
export function HomeOverview() {
  // The activation checklist reads the browser's query cache: render it once
  // hydrated.
  const hydrated = useHydrated();

  return (
    <div className="flex flex-col gap-12 lg:gap-16">
      {hydrated ? <BankAlertsBanner /> : null}

      <NetWorthHero />

      {hydrated ? <HomeActivation /> : null}

      <ThisMonthSection />

      <div className="grid gap-12 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-16">
        <BalanceSheetSection />
        <div className="flex min-w-0 flex-col gap-12 lg:gap-16">
          <CashflowSection />
          <LoansSection />
        </div>
      </div>

      <LatestTransactionsSection />
    </div>
  );
}
