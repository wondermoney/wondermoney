"use client";

import { Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Transaction } from "@/lib/api/account/useTransactions";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

/** Loan context on hover, keyboard focus or tap, without increasing the row height. */
export function TransactionLoanRepaymentInfo({
  transaction,
}: {
  transaction: Transaction;
}) {
  const t = useTranslations();
  const formatCurrency = useFormatCurrency();
  const [open, setOpen] = useState(false);
  const repayment = transaction.loanRepayment;
  if (!repayment) return null;

  return (
    <TooltipProvider>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger
          aria-label={t("linked-loan-repayment-details")}
          className="text-muted-foreground hover:text-foreground relative inline-flex size-5 shrink-0 items-center justify-center after:absolute after:-inset-3 after:content-['']"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setOpen(!open);
          }}
        >
          <Info className="size-4" aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent className="max-w-64 font-sans text-xs whitespace-normal">
          {t.rich("linked-loan-repayment-context", {
            figure: (chunks) => (
              <span className="font-mono whitespace-nowrap">{chunks}</span>
            ),
            loanName: repayment.loanName,
            expense: formatCurrency(
              repayment.spendingAmount,
              transaction.appuserCurrencyKey.code,
            ),
            total: formatCurrency(
              transaction.appuserSettlementAmount ?? 0,
              transaction.appuserCurrencyKey.code,
            ),
          })}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
