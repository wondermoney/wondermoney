"use client";

import { ArrowLeft, Link2, Pencil, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import LoanAdjustmentDialog from "@/components/loan/LoanAdjustmentDialog";
import LoanAmortizationPreview from "@/components/loan/LoanAmortizationPreview";
import LoanAssumptionsCard from "@/components/loan/LoanAssumptionsCard";
import LoanDetailHeader from "@/components/loan/LoanDetailHeader";
import LoanDetailSummaryCards from "@/components/loan/LoanDetailSummaryCards";
import LoanFormDrawer from "@/components/loan/LoanFormDrawer";
import LoanRepaymentsTable from "@/components/loan/LoanRepaymentsTable";
import RepaymentCandidateDrawer from "@/components/loan/RepaymentCandidateDrawer";
import { Amount } from "@/components/ui/Amount";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useRouter } from "@/i18n/navigation";
import type { LoanRepayment } from "@/lib/api/loan/types";
import useDeleteLoanRepayment from "@/lib/api/loan/useDeleteLoanRepayment";
import useLoan from "@/lib/api/loan/useLoan";
import useLoanRepayments from "@/lib/api/loan/useLoanRepayments";

export default function LoanDetailClient({ loanId }: { loanId: string }) {
  const t = useTranslations("loans");
  const router = useRouter();
  const [candidatesOpen, setCandidatesOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [editingRepayment, setEditingRepayment] =
    useState<LoanRepayment | null>(null);
  const deleteMutation = useDeleteLoanRepayment();
  const {
    data: loanData,
    isLoading: loanLoading,
    isError: loanError,
  } = useLoan(loanId);
  const { data: repaymentsData, isLoading: repaymentsLoading } =
    useLoanRepayments(loanId);
  const loan = loanData?.loan;
  const repayments = repaymentsData?.repayments ?? [];

  const summary = useMemo(() => {
    const principal = loan?.openingPrincipalBalance ?? 0;
    const outstanding = loan?.outstandingPrincipal ?? 0;
    const payment = loan?.regularPaymentAmount ?? 0;
    const rate = loan?.annualInterestRateBps ?? 0;
    const remaining =
      loan?.remainingTermMonthsEstimated ?? loan?.termMonths ?? null;
    const progress =
      principal > 0
        ? Math.max(
            0,
            Math.min(100, ((principal - outstanding) / principal) * 100),
          )
        : 0;
    return { principal, outstanding, payment, rate, remaining, progress };
  }, [loan]);

  if (loanLoading)
    return (
      <div className="space-y-4">
        <div className="bg-muted h-10 w-56 animate-pulse rounded motion-reduce:animate-none" />
        <div className="bg-muted h-40 animate-pulse rounded motion-reduce:animate-none" />
        <div className="text-muted-foreground text-sm">
          {t("detail.loading")}
        </div>
      </div>
    );
  if (loanError || !loan)
    return (
      <Card>
        <CardContent className="p-6">
          <div className="space-y-3">
            <h1 className="text-lg font-semibold">
              {t("detail.errors.loadFailed")}
            </h1>
            <p className="text-muted-foreground text-sm">
              {t("detail.errors.loadFailedBody")}
            </p>
            <Button variant="secondary" onClick={() => router.push("/loans")}>
              <ArrowLeft className="mr-2 size-4" />
              {t("detail.actions.back")}
            </Button>
          </div>
        </CardContent>
      </Card>
    );

  return (
    <div className="space-y-6">
      <LoanDetailHeader
        loan={loan}
        summary={summary}
        onLinkRepayments={() => setCandidatesOpen(true)}
        onEdit={() => setEditOpen(true)}
      />
      <LoanDetailSummaryCards loan={loan} summary={summary} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <LoanRepaymentsTable
            loan={loan}
            repayments={repayments}
            loading={repaymentsLoading}
            onLinkRepayment={() => setCandidatesOpen(true)}
            onEditRepayment={(repayment) => {
              setEditingRepayment(repayment);
              setCandidatesOpen(true);
            }}
            onRemoveRepayment={async (repayment) => {
              if (!window.confirm(t("detail.repayments.removeConfirm"))) return;
              await deleteMutation.mutateAsync({
                loanId: loan.loanKey,
                repaymentLinkId: repayment.loanRepaymentLinkKey,
              });
            }}
          />
          <LoanAmortizationPreview loan={loan} repayments={repayments} />
        </div>
        <div className="space-y-6">
          <LoanAssumptionsCard loan={loan} />
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="text-sm font-medium">
                {t("detail.actions.title")}
              </div>
              <div className="flex flex-col gap-2">
                <Button onClick={() => setCandidatesOpen(true)}>
                  <Link2 className="mr-2 size-4" />
                  {t("actions.linkRepayment")}
                </Button>
                <Button variant="secondary" onClick={() => setEditOpen(true)}>
                  <Pencil className="mr-2 size-4" />
                  {t("actions.edit")}
                </Button>
                <Button variant="outline" onClick={() => setAdjustOpen(true)}>
                  <RefreshCw className="mr-2 size-4" />
                  {t("detail.actions.adjustBalance")}
                </Button>
              </div>
              <div className="text-muted-foreground text-xs">
                <Amount
                  value={summary.outstanding}
                  currency={loan.currency.code}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      <RepaymentCandidateDrawer
        loan={loan}
        open={candidatesOpen}
        onOpenChange={(open) => {
          setCandidatesOpen(open);
          if (!open) setEditingRepayment(null);
        }}
        initialRepayment={editingRepayment}
      />
      <LoanFormDrawer open={editOpen} onOpenChange={setEditOpen} loan={loan} />
      <LoanAdjustmentDialog
        open={adjustOpen}
        onOpenChange={setAdjustOpen}
        loan={loan}
      />
    </div>
  );
}
