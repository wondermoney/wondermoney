/**
 * "Mark as transfer": a row the bank sent as a payment or deposit that is
 * really money moving between the user's own money (a savings pot, a broker,
 * another account). A transfer is left out of spending, income, budgets and
 * the home cash flow. The API records the new type as set by the user, so
 * transfer matching never reverts it.
 */

export type TransferDestinationType = "account" | "portfolio" | "goal";

export interface TransferDestination {
  type: TransferDestinationType;
  key: number;
}

/** A destination as a transaction row carries it, with its display name. */
export interface TransferDestinationRow extends TransferDestination {
  name: string;
}

export type EditableTransactionType =
  "TRANSFER_OUT" | "TRANSFER_IN" | "PAYMENT" | "DEPOSIT";

export interface TransferEdit {
  transactionType?: EditableTransactionType;
  transferDestination?: TransferDestination | null;
}

export function isTransferType(name: string | null | undefined): boolean {
  return name === "TRANSFER_OUT" || name === "TRANSFER_IN";
}

/** The type the API accepts for a row of this sign: a transfer, or not. */
export function transferTypeFor(
  amount: number,
  transfer: boolean,
): EditableTransactionType {
  if (amount < 0) return transfer ? "TRANSFER_OUT" : "PAYMENT";
  return transfer ? "TRANSFER_IN" : "DEPOSIT";
}

/** `account:12`, the value a destination takes in a select. */
export function encodeTransferDestination(
  destination: TransferDestination | null | undefined,
): string {
  return destination ? `${destination.type}:${destination.key}` : "none";
}

export function decodeTransferDestination(
  value: string,
): TransferDestination | null {
  const [type, key] = value.split(":");
  const parsed = Number(key);
  if (
    (type === "account" || type === "portfolio" || type === "goal") &&
    Number.isSafeInteger(parsed) &&
    parsed > 0
  ) {
    return { type, key: parsed };
  }
  return null;
}

function sameDestination(
  a: TransferDestination | null | undefined,
  b: TransferDestination | null | undefined,
): boolean {
  return (
    (a?.type ?? null) === (b?.type ?? null) &&
    (a?.key ?? null) === (b?.key ?? null)
  );
}

/**
 * What the edit form must send to change a row's transfer state, or `{}`
 * when nothing changed. Only an outgoing transfer carries a destination;
 * un-marking a transfer clears it on the API side, so it is not sent.
 */
export function buildTransferEdit(
  transaction: {
    amount: number;
    transactionType: string | null | undefined;
    transferDestination: TransferDestination | null | undefined;
  },
  next: { transfer: boolean; destination: TransferDestination | null },
): TransferEdit {
  if (transaction.amount === 0) return {};
  const edit: TransferEdit = {};
  const wasTransfer = isTransferType(transaction.transactionType);
  if (next.transfer !== wasTransfer) {
    edit.transactionType = transferTypeFor(transaction.amount, next.transfer);
  }
  if (
    next.transfer &&
    transaction.amount < 0 &&
    !sameDestination(transaction.transferDestination, next.destination)
  ) {
    edit.transferDestination = next.destination;
  }
  return edit;
}
