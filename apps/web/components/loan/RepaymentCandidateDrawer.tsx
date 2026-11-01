"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

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
    useState<LoanRepayment | null>(open ? (initialRepayment ?? null) : null);
  // Opening (or a new initial repayment while open) loads that repayment;
  // closing clears the selection. Adjusted during render, not in effects.
  const [syncedFrom, setSyncedFrom] = useState({ open, initialRepayment });
  if (
    syncedFrom.open !== open ||
    syncedFrom.initialRepayment !== initialRepayment
  ) {
    setSyncedFrom({ open, initialRepayment });
    if (open) {
      setSelectedRepayment(initialRepayment ?? null);
    } else if (syncedFrom.open) {
      setSelectedTransactionKey(null);
      setSelectedRepayment(null);
    }
  }
  const { data, isLoading } = useLoanRepaymentCandidates(
    loan.loanKey,
    {},
    { enabled: open },
  );
  const candidate =
    data?.candidates.find(
      (item) => item.transactionKey === selectedTransactionKey,
    ) ?? null;
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
