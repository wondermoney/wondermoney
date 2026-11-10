"use client";

import { Amount } from "@/components/ui/Amount";
import { FxStatusBadge } from "@/components/ui/FxStatusBadge";
import type { Transaction } from "@/lib/api/account/useTransactions";
import { transactionFxView } from "@/lib/fx/fx-status";
import { cn } from "@/lib/utils";

type AmountRow = Pick<
  Transaction,
  | "appuserCurrencyKey"
  | "appuserSettlementAmount"
  | "editedSettlementAmount"
  | "fxRateDate"
  | "fxStatus"
  | "settlementAmount"
  | "settlementCurrencyKey"
>;

/**
 * The figure a transaction row shows: its amount in the user's currency, or,
 * when no exchange rate converts it, its original amount in its own currency
 * (never a converted-looking figure and never an em-dash).
 */
export function transactionDisplayAmount(transaction: AmountRow): {
  value: number | null;
  currency: string;
} {
  if (transactionFxView(transaction).status === "missing") {
    return {
      value: transaction.settlementAmount,
      currency: transaction.settlementCurrencyKey.code,
    };
  }
  return {
    value:
      transaction.editedSettlementAmount ?? transaction.appuserSettlementAmount,
    currency: transaction.appuserCurrencyKey.code,
  };
}

/**
 * A transaction's amount with how it was converted: "Not converted" beside
 * an original amount that has no rate, "Estimated" beside one converted at an
 * old rate. `className` styles the figure.
 */
export function TransactionAmount({
  transaction,
  className,
  badgeClassName,
  signed = false,
}: {
  transaction: AmountRow;
  className?: string;
  badgeClassName?: string;
  /** Prefix a plus to an inflow, as `Amount` does. */
  signed?: boolean;
}) {
  const { value, currency } = transactionDisplayAmount(transaction);
  const view = transactionFxView(transaction);

  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
      <FxStatusBadge
        view={view}
        originalCurrency={transaction.settlementCurrencyKey.code}
        className={badgeClassName}
      />
      <Amount
        value={value}
        currency={currency}
        signed={signed}
        className={cn(className)}
      />
    </span>
  );
}
