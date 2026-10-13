"use client";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { DrawerDialog } from "@/components/ui/dialog-responsive";
import type { LoanDetail, LoanRepayment } from "@/lib/api/loan/types";
import useLoanRepaymentCandidates from "@/lib/api/loan/useLoanRepaymentCandidates";

import RepaymentAllocationForm from "./RepaymentAllocationForm";
import RepaymentCandidateList from "./RepaymentCandidateList";

export default function RepaymentCandidateDrawer({
  loan,
  open,
  onOpenChange,
  initialRepayment,
}: {
  loan: LoanDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialRepayment?: LoanRepayment | null;
}) {
  const t = useTranslations("loans");
  const [selectedTransactionKey, setSelectedTransactionKey] = useState<
    number | null
  >(null);
  const [selectedRepayment, setSelectedRepayment] =
    useState<LoanRepayment | null>(initialRepayment ?? null);
  const { data, isLoading } = useLoanRepaymentCandidates(
    loan.loanKey,
    {},
    { enabled: open },
  );
  const candidate =
    data?.candidates.find(
      (item) => item.transactionKey === selectedTransactionKey,
    ) ?? null;
  useEffect(() => {
    if (open) setSelectedRepayment(initialRepayment ?? null);
  }, [initialRepayment, open]);
  useEffect(() => {
    if (!open) {
      setSelectedTransactionKey(null);
      setSelectedRepayment(null);
    }
  }, [open]);
  const selectedCandidate = candidate ?? null;
  return (
    <DrawerDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        selectedCandidate
          ? t("detail.repayments.reviewTitle")
          : t("detail.repayments.candidatesTitle")
      }
      description={
        selectedCandidate
          ? t("detail.repayments.reviewDescription")
          : t("detail.repayments.candidatesDescription")
      }
      closable
    >
      <div className="space-y-4">
        {selectedCandidate ? (
          <RepaymentAllocationForm
            loan={loan}
            candidate={selectedCandidate}
            existingRepayment={selectedRepayment}
            onDone={() => {
              setSelectedTransactionKey(null);
              setSelectedRepayment(null);
              onOpenChange(false);
            }}
            onBack={() => {
              setSelectedTransactionKey(null);
              setSelectedRepayment(null);
            }}
          />
        ) : (
          <RepaymentCandidateList
            candidates={data?.candidates ?? []}
            loading={isLoading}
            onSelect={setSelectedTransactionKey}
          />
        )}
      </div>
    </DrawerDialog>
  );
}
