import type {
  LinkedTransaction,
  ReimbursementLink,
  ReimbursementRole,
} from "@/lib/api/account/useTransactionReimbursements";
import type { Transaction } from "@/lib/api/account/useTransactions";
import { API_ERROR_CODE, getApiErrorCode } from "@/lib/api/errors";

import { amountToUnits } from "./transaction-split";
import { isTransferType } from "./transaction-transfer";

/**
 * The rules the client applies to reimbursement links (`lib/api/account/
 * useTransactionReimbursements.ts`): which side of a link a transaction can be, what its row's
 * badge says, and what a link amount defaults to. Amounts are compared in the split editor's
 * integer units of 0.0001, so "fully reimbursed" never hangs on a float.
 */

type RoleFields = Pick<
  Transaction,
  | "transactionKey"
  | "settlementAmount"
  | "editedSettlementAmount"
  | "transactionTypeKey"
  | "loanRepayment"
>;

/** The row's amount as the API counts it: the user's edit wins. */
export function effectiveAmount(
  transaction: Pick<Transaction, "settlementAmount" | "editedSettlementAmount">,
): number {
  return Number(
    transaction.editedSettlementAmount ?? transaction.settlementAmount,
  );
}

/**
 * The side of a link the transaction can take: money in is a reimbursement, money out an
 * expense. Null for what cannot be linked at all: a synthetic row, a zero amount, a transfer or
 * a loan repayment.
 */
export function reimbursementRoleOf(
  transaction: RoleFields,
): ReimbursementRole | null {
  if (transaction.transactionKey <= 0) return null;
  if (isTransferType(transaction.transactionTypeKey?.name)) return null;
  if (transaction.loanRepayment) return null;
  const amount = effectiveAmount(transaction);
  if (amount > 0) return "reimbursement";
  if (amount < 0) return "expense";
  return null;
}

/** The transaction at the other end of a link from `transactionKey`. */
export function otherSideOf(
  link: ReimbursementLink,
  transactionKey: number,
): LinkedTransaction {
  return link.reimbursement.transactionKey === transactionKey
    ? link.expense
    : link.reimbursement;
}

/** How a linked transaction is named: who was paid, else what the bank said. */
export function linkedTransactionTitle(
  transaction: Pick<LinkedTransaction, "merchantName" | "description">,
): string | null {
  return (
    transaction.merchantName?.trim() || transaction.description?.trim() || null
  );
}

export type ReimbursementBadgeKind =
  "reimbursed" | "partly-reimbursed" | "reimbursement";

/**
 * What the row's badge says. An expense whose links cover its whole amount is reimbursed, one
 * with less is partly reimbursed; money in with links is a reimbursement. Null without links.
 */
export function reimbursementBadgeKind(
  transaction: Pick<
    Transaction,
    | "transactionKey"
    | "settlementAmount"
    | "editedSettlementAmount"
    | "reimbursements"
  >,
): ReimbursementBadgeKind | null {
  const links = transaction.reimbursements ?? [];
  if (links.length === 0) return null;
  const amount = effectiveAmount(transaction);
  if (amount > 0) return "reimbursement";
  const linked = links
    .filter(
      (link) => link.expense.transactionKey === transaction.transactionKey,
    )
    .reduce((sum, link) => sum + amountToUnits(link.amount), 0n);
  const total = amountToUnits(Math.abs(amount));
  return linked >= total ? "reimbursed" : "partly-reimbursed";
}

/**
 * What a new link defaults to: as much as both sides still have free, in units. A 20 refund
 * against a 50 expense links 20; a 50 refund against a 20 expense links 20.
 */
export function defaultLinkUnits(
  ownRemaining: number,
  candidateRemaining: number,
): bigint {
  const own = amountToUnits(Math.max(0, ownRemaining));
  const candidate = amountToUnits(Math.max(0, candidateRemaining));
  return own < candidate ? own : candidate;
}

export type ReimbursementErrorKey =
  | "not-found"
  | "currency-mismatch"
  | "amount-exceeded"
  | "visibility-mismatch"
  | "invalid"
  | "link-exists";

/** The message for a refused link or unlink, by the API's error code; null for anything else. */
export function reimbursementErrorKey(
  error: unknown,
): ReimbursementErrorKey | null {
  switch (getApiErrorCode(error)) {
    case API_ERROR_CODE.NOT_FOUND:
      return "not-found";
    case API_ERROR_CODE.REIMBURSEMENT_CURRENCY_MISMATCH:
      return "currency-mismatch";
    case API_ERROR_CODE.REIMBURSEMENT_AMOUNT_EXCEEDED:
      return "amount-exceeded";
    case API_ERROR_CODE.REIMBURSEMENT_VISIBILITY_MISMATCH:
      return "visibility-mismatch";
    case API_ERROR_CODE.REIMBURSEMENT_INVALID:
      return "invalid";
    case API_ERROR_CODE.REIMBURSEMENT_LINK_EXISTS:
      return "link-exists";
    default:
      return null;
  }
}
