"use client";

import {
  type DashboardSectionId,
  mergeDashboardLayout,
} from "@wondermoney/shared/dashboard-layout";
import { SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { Fragment, type ReactNode, useState } from "react";

import AccountsFreshness from "@/components/account/AccountsFreshness";
import {
  NoAccountsCard,
  useHasNoAccounts,
} from "@/components/activation/NoAccountsCard";
import { SetupChecklistCard } from "@/components/activation/SetupChecklistCard";
import { MemberFilterControl } from "@/components/household/MemberFilterSelect";
import { Button } from "@/components/ui/button";
import useAccounts from "@/lib/api/account/useAccounts";
import useTransactions from "@/lib/api/account/useTransactions";
import useBudgetsFull from "@/lib/api/budget/useBudgetsFull";
import usePortfolios from "@/lib/api/portfolio/usePortfolios";
import useUserPreferences from "@/lib/api/user-preferences/useUserPreferences";
import { useMemberFilter } from "@/lib/household/useMemberFilter";
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

/** The ways in for a household with no accounts, then the activation checklist. */
function HomeActivation() {
  const { data: accountsData, isSuccess: accountsLoaded } = useAccounts();
  const { data: portfoliosData } = usePortfolios();
  const { data: budgetsData } = useBudgetsFull();
  const { data: anyTransaction } = useTransactions(ANY_TRANSACTION);
  const { data: anyUnreviewed } = useTransactions(ANY_UNREVIEWED);

  const accountCount = accountsData?.accounts?.length ?? 0;
  const portfolioCount = portfoliosData?.portfolios?.length ?? 0;
  const hasTransactions = Boolean(anyTransaction?.transactions?.length);

  return (
    <>
      <NoAccountsCard />
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
  const { data: accountsData } = useAccounts();
  const t = useTranslations("homeOverview.customize");
  const preferences = useUserPreferences();
  const [customizing, setCustomizing] = useState(false);
  const layout = mergeDashboardLayout(preferences.data?.dashboardLayout);
  // One member's (or Shared) home, from the URL's `member`. The budget month and loans stay the
  // household's: their figures come from endpoints that do not take the filter.
  const { filter: member } = useMemberFilter();
  // The no-accounts card offers the ways in, so the net worth's own "Add an account" steps aside.
  const noAccounts = useHasNoAccounts();

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
    <div className="flex flex-col gap-8 sm:gap-12 lg:gap-16">
      {hydrated ? <BankAlertsBanner /> : null}

      <div className="flex flex-col gap-2">
        <NetWorthHero
          member={member}
          hideEmptyAction={hydrated && noAccounts}
          actions={
            <>
              <MemberFilterControl iconOnly />
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("action")}
                title={t("action")}
                className="size-11"
                onClick={() => setCustomizing(true)}
              >
                <SlidersHorizontal className="size-4" aria-hidden="true" />
              </Button>
            </>
          }
        />
        {hydrated ? <HomeActivation /> : null}
      </div>

      {layout
        .filter((entry) => entry.id !== "net-worth" && !entry.hidden)
        .map((entry) => (
          <Fragment key={entry.id}>
            {sections[entry.id as Exclude<DashboardSectionId, "net-worth">]}
          </Fragment>
        ))}

      <CustomizeHomeSheet open={customizing} onOpenChange={setCustomizing} />
      {hydrated ? (
        <footer>
          <AccountsFreshness accounts={accountsData?.accounts} />
        </footer>
      ) : null}
    </div>
  );
}
