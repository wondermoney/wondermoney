"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import LoanFormDrawer from "@/components/loan/LoanFormDrawer";
import LoansSummaryCards from "@/components/loan/LoansSummaryCards";
import LoansTable from "@/components/loan/LoansTable";
import { Amount } from "@/components/ui/Amount";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PreviewBadge } from "@/components/ui/PreviewBadge";
import { useRouter } from "@/i18n/navigation";
import useLoanOverview from "@/lib/api/loan/useLoanOverview";
import useLoans from "@/lib/api/loan/useLoans";
import useNetWorth from "@/lib/api/net-worth/useNetWorth";

export default function LoansClient() {
  const t = useTranslations("loans");
  const tCommon = useTranslations();
  const router = useRouter();
  const { data: overviewData } = useLoanOverview();
  const { data: loansData, isLoading: isLoansLoading } = useLoans();
  const {
    data: netWorthData,
    isLoading: isNetWorthLoading,
    isError: isNetWorthError,
  } = useNetWorth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedLoanKey, setSelectedLoanKey] = useState<number | null>(null);
  const loans = loansData?.loans ?? [];
  const selectedLoan = loans.find((c) => c.loanKey === selectedLoanKey) ?? null;
  const hasLoans = loans.length > 0;
  const totalOutstanding =
    overviewData?.overview.totalOutstandingAmount ??
    overviewData?.overview.totalOutstandingDebt ??
    0;
  const monthlyRepaymentTotal = loans.reduce(
    (sum, c) => sum + (c.regularPaymentAmount || 0),
    0,
  );
  const netWorthImpact = netWorthData
    ? -(netWorthData.netWorth.liabilitiesTotal ?? 0)
    : null;
  const netWorthImpactLabel =
    isNetWorthLoading && !netWorthData
      ? tCommon("loading")
      : isNetWorthError && !netWorthData
        ? tCommon("unavailable")
        : undefined;

  if (!hasLoans && !isLoansLoading) {
    return (
      <Card className="border-border p-6">
        <div className="space-y-4">
          <div>
            <h1 className="text-foreground text-xl font-semibold tracking-tight">
              {t("empty.title")}
            </h1>
            <p className="text-muted-foreground text-sm">
              {t("empty.description")}
            </p>
          </div>
          {/* Background-step, not a second border — the outer Card already
              has one (No-Nesting rule). */}
          <div className="bg-muted/30 rounded-lg p-4">
            <div className="border-border/70 flex items-center justify-between border-b pb-3 text-sm">
              <PreviewBadge />
              <span className="text-muted-foreground">
                {t("emptyPreview.subtitle")}
              </span>
            </div>
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">
                    {t("emptyPreview.sampleName")}
                  </div>
                  <div className="text-muted-foreground text-sm">
                    {t("emptyPreview.sampleProvider")}
                  </div>
                </div>
                <div className="text-muted-foreground text-sm">
                  {t("emptyPreview.sampleStatus")}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-background rounded-md p-3">
                  <div className="text-muted-foreground">
                    {t("table.outstanding")}
                  </div>
                  <div className="mt-1 font-mono">
                    <Amount
                      value={0}
                      currency={netWorthData?.netWorth.currencyCode ?? "EUR"}
                    />
                  </div>
                </div>
                <div className="bg-background rounded-md p-3">
                  <div className="text-muted-foreground">{t("table.term")}</div>
                  <div className="mt-1 font-mono">
                    {t("emptyPreview.sampleTerm")}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <Button onClick={() => setDrawerOpen(true)}>
            <Plus className="mr-2 size-4" />
            {t("actions.add")}
          </Button>
        </div>
        <LoanFormDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-foreground text-xl font-semibold tracking-tight">
            {t("page.title")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t("page.description")}
          </p>
        </div>
        <Button onClick={() => setDrawerOpen(true)}>
          <Plus className="mr-2 size-4" />
          {t("actions.add")}
        </Button>
      </div>
      <LoansSummaryCards
        currencyCode={
          netWorthData?.netWorth.currencyCode ??
          loans[0]?.currency.code ??
          "EUR"
        }
        totalOutstandingAmount={totalOutstanding}
        monthlyRepaymentTotal={monthlyRepaymentTotal}
        interestAndFeesThisMonth={
          overviewData?.overview.totalInterestAmount ??
          overviewData?.overview.interestFeesThisMonth ??
          0
        }
        netWorthImpact={netWorthImpact ?? 0}
        netWorthImpactLabel={netWorthImpactLabel}
        repaymentsNeedingReview={
          overviewData?.overview.overdueLoansCount ??
          overviewData?.overview.repaymentsNeedingReviewCount ??
          0
        }
      />
      <LoansTable
        loans={loans}
        onRowClick={(loanKey) => router.push(`/loans/${loanKey}`)}
        onEdit={(loan) => {
          setSelectedLoanKey(loan.loanKey);
          setDrawerOpen(true);
        }}
      />
      <LoanFormDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        loan={selectedLoan}
      />
    </div>
  );
}
