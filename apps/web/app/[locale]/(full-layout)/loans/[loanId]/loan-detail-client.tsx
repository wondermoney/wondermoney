"use client";

import { ArrowLeft, RefreshCw } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useRouter } from "@/i18n/navigation";
import type { LoanRepayment } from "@/lib/api/loan/types";
import useDeleteLoanRepayment from "@/lib/api/loan/useDeleteLoanRepayment";
import useLoan from "@/lib/api/loan/useLoan";
import useLoanRepayments from "@/lib/api/loan/useLoanRepayments";
import { loanSummary } from "@/lib/loans/loan-summary";

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

  const summary = useMemo(() => (loan ? loanSummary(loan) : null), [loan]);

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
  if (loanError || !loan || !summary)
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
    <div className="flex flex-col gap-10 lg:gap-12">
      <LoanDetailHeader
        loan={loan}
        summary={summary}
        onLinkRepayments={() => setCandidatesOpen(true)}
        onEdit={() => setEditOpen(true)}
      />
      <LoanDetailSummaryCards loan={loan} summary={summary} />
      {/* The repayments ledger takes the full width: eight columns do not
          fit beside the assumptions without cutting the last one off. */}
      <LoanRepaymentsTable
        loan={loan}
        repayments={repayments}
        loading={repaymentsLoading}
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
      <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_380px] xl:gap-12">
        <div className="min-w-0">
          <LoanAmortizationPreview loan={loan} repayments={repayments} />
        </div>
        <div className="min-w-0">
          {/* Linking a repayment and editing the loan sit in the header; the
              balance adjustment is the one action only this page offers. */}
          <LoanAssumptionsCard
            loan={loan}
            action={
              <Button variant="secondary" onClick={() => setAdjustOpen(true)}>
                <RefreshCw className="mr-2 size-4" />
                {t("detail.actions.adjustBalance")}
              </Button>
            }
          />
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
