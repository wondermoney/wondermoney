"use client";

import { Landmark } from "lucide-react";
import { useTranslations } from "next-intl";

import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { ReportFiltersBar } from "@/components/reports/filters/ReportFiltersBar";
import { ReportEmptyState } from "@/components/reports/primitives";
import {
  BudgetVsActualReport,
  CashflowReport,
  NetWorthHistoryReport,
  PortfolioPerformanceReport,
  SankeyReport,
  SpendingByCategoryReport,
} from "@/components/reports/reports";
import { ReportsCurrencyProvider } from "@/components/reports/ReportsCurrencyContext";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import useAccounts from "@/lib/api/account/useAccounts";

export default function ReportsPage() {
  const t = useTranslations("reports");
  const tRoot = useTranslations();
  const { data: accountsData } = useAccounts();
  const hasAccounts = accountsData ? accountsData.accounts.length > 0 : true;

  return (
    <PageShell>
      <PageHeader title={t("title")} />

      {!hasAccounts ? (
        <ReportEmptyState
          icon={Landmark}
          title={tRoot("connect-your-bank-account")}
          description={tRoot("bank-connection-description")}
          cta={
            <Button asChild size="sm">
              <Link href="/accounts">{tRoot("add-account")}</Link>
            </Button>
          }
          className="py-16"
        />
      ) : (
        <ReportsCurrencyProvider>
          <div className="flex flex-col gap-4">
            <ReportFiltersBar />

            {/* Flagship Sankey — full width, prime real estate */}
            <section aria-labelledby="reports-sankey-title">
              <span id="reports-sankey-title" className="sr-only">
                {t("reports.sankey.title")}
              </span>
              <SankeyReport />
            </section>

            {/* Cash flow + spending breakdown side by side */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <CashflowReport />
              <SpendingByCategoryReport />
            </div>

            {/* Net worth over time — full width for the trend */}
            <section aria-labelledby="reports-net-worth-title">
              <span id="reports-net-worth-title" className="sr-only">
                {t("reports.netWorthHistory.title")}
              </span>
              <NetWorthHistoryReport />
            </section>

            {/* Budget vs actual + portfolio performance side by side */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <BudgetVsActualReport />
              <PortfolioPerformanceReport />
            </div>
          </div>
        </ReportsCurrencyProvider>
      )}
    </PageShell>
  );
}
