/**
 * Stored sign convention for a transaction amount: negative is money leaving the account,
 * positive is money arriving. Bank sync stores provider amounts as signed, and every aggregate
 * (balance chain, cashflow, budgets, net worth, loan-repayment candidates) reads the sign as the
 * direction.
 *
 * Manual entry (web, mobile, OCR confirm, generic CSV import) sends a transaction type for direction, so
 * the type is authoritative and the amount is treated as a magnitude: a caller that also signs the
 * amount ("-42.50" as a card payment) gets the same row as one that does not. Types with no
 * inherent direction keep the caller's sign.
 */
const OUTGOING_TRANSACTION_TYPES: ReadonlySet<string> = new Set(['atm', 'card_payment', 'fee', 'fees', 'loan', 'payment', 'transfer_out']);
const INCOMING_TRANSACTION_TYPES: ReadonlySet<string> = new Set(['card_refund', 'cashback', 'deposit', 'reward', 'topup', 'transfer_in']);

export function signTransactionAmount(amount: number, typeName: string): number {
  const type = typeName.toLowerCase();
  const magnitude = Math.abs(amount);
  if (magnitude === 0) return 0;
  if (OUTGOING_TRANSACTION_TYPES.has(type)) return -magnitude;
  if (INCOMING_TRANSACTION_TYPES.has(type)) return magnitude;
  return amount;
}

/**
 * Sources that carry their own direction (a bank statement's signed amount) work the other way
 * round: the sign is authoritative and the type is a label, guessed from the description. This
 * returns a type that agrees with the sign: the guess when it already does (or has no direction),
 * otherwise its counterpart, or a generic type for that direction. Names come back upper-case, as
 * stored in `transaction_type.name`.
 *
 * A guessed transfer is not trusted: a statement line reads the same whether the money came from
 * the household's other account or from an employer. It is labelled as money in (DEPOSIT) or out
 * (PAYMENT), as bank sync labels it, and transfer matching re-types the two halves of a transfer
 * between the household's own accounts.
 */
const INCOMING_COUNTERPART: Readonly<Record<string, string>> = { atm: 'DEPOSIT', card_payment: 'CARD_REFUND' };
const OUTGOING_COUNTERPART: Readonly<Record<string, string>> = { card_refund: 'CARD_PAYMENT' };
const GUESSED_TRANSFER_TYPES: ReadonlySet<string> = new Set(['transfer', 'transfer_in', 'transfer_out']);
const GENERIC_INCOMING_TYPE = 'DEPOSIT';
const GENERIC_OUTGOING_TYPE = 'PAYMENT';

export function transactionTypeForSignedAmount(guessedTypeName: string, signedAmount: number): string {
  const type = guessedTypeName.toLowerCase();
  if (GUESSED_TRANSFER_TYPES.has(type)) return signedAmount < 0 ? GENERIC_OUTGOING_TYPE : GENERIC_INCOMING_TYPE;
  if (signedAmount > 0 && OUTGOING_TRANSACTION_TYPES.has(type)) return INCOMING_COUNTERPART[type] ?? GENERIC_INCOMING_TYPE;
  if (signedAmount < 0 && INCOMING_TRANSACTION_TYPES.has(type)) return OUTGOING_COUNTERPART[type] ?? GENERIC_OUTGOING_TYPE;
  return guessedTypeName.toUpperCase();
}
