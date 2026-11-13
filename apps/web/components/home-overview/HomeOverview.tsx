"use client";

import {
  type DashboardSectionId,
  mergeDashboardLayout,
} from "@wondermoney/shared/dashboard-layout";
import { SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { Fragment, type ReactNode, useState } from "react";

import { SetupChecklistCard } from "@/components/activation/SetupChecklistCard";
import { NetWorthViewedEvent } from "@/components/dashboard/NetWorthViewedEvent";
import { MemberFilterControl } from "@/components/household/MemberFilterSelect";
import { Button } from "@/components/ui/button";
import useAccounts, { type Account } from "@/lib/api/account/useAccounts";
import useTransactions from "@/lib/api/account/useTransactions";
import useBudgetsFull from "@/lib/api/budget/useBudgetsFull";
import useNetWorth from "@/lib/api/net-worth/useNetWorth";
import usePortfolios from "@/lib/api/portfolio/usePortfolios";
import useUserPreferences from "@/lib/api/user-preferences/useUserPreferences";
import { useMemberFilter } from "@/lib/household/useMemberFilter";
import { isValidFirstNetWorthState } from "@/lib/utils/analytics";
import { useHydrated } from "@/lib/utils/useHydrated";

import { BalanceSheetSection } from "./BalanceSheetSection";
import { BankAlertsBanner } from "./BankAlertsBanner";
import { CashflowSection } from "./CashflowSection";
import { CustomizeHomeSheet } from "./CustomizeHomeSheet";
import { InsightsSection } from "./InsightsSection";
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
 * figure that sums up the household; the rest follow in the person's own order
 * (see `CustomizeHomeSheet`), and a hidden section is not rendered at all.
 *
 * The activation checklist and the bank alerts are not sections: they appear
 * when they have something to say and keep their own dismissal.
 */
export function HomeOverview() {
  // The activation checklist reads the browser's query cache: render it once
  // hydrated.
  const hydrated = useHydrated();
  const t = useTranslations("homeOverview.customize");
  const preferences = useUserPreferences();
  const [customizing, setCustomizing] = useState(false);
  const layout = mergeDashboardLayout(preferences.data?.dashboardLayout);
  // One member's (or Shared) home, from the URL's `member`. The budget month and loans stay the
  // household's: their figures come from endpoints that do not take the filter.
  const { filter: member } = useMemberFilter();

  const sections: Record<
    Exclude<DashboardSectionId, "net-worth">,
    ReactNode
  > = {
    insights: <InsightsSection />,
    "this-month": <ThisMonthSection />,
    "balance-sheet": <BalanceSheetSection member={member} />,
    cashflow: <CashflowSection member={member} />,
    loans: <LoansSection />,
    "latest-transactions": <LatestTransactionsSection member={member} />,
  };

  return (
    <div className="flex flex-col gap-12 lg:gap-16">
      {hydrated ? <BankAlertsBanner /> : null}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-end gap-2">
          <MemberFilterControl className="w-40 sm:w-44" />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setCustomizing(true)}
          >
            <SlidersHorizontal className="size-4" />
            {t("action")}
          </Button>
        </div>
        <NetWorthHero member={member} />
      </div>

      {hydrated ? <HomeActivation /> : null}

      {layout
        .filter((entry) => entry.id !== "net-worth" && !entry.hidden)
        .map((entry) => (
          <Fragment key={entry.id}>
            {sections[entry.id as Exclude<DashboardSectionId, "net-worth">]}
          </Fragment>
        ))}

      <CustomizeHomeSheet open={customizing} onOpenChange={setCustomizing} />
    </div>
  );
}
