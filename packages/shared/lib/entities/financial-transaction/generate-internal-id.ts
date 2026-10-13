export function generateInternalFinancialTransactionId(
  transactionDate: Date,
  asset: string,
  amount: string | number,
  externalTransactionId?: string
) {
  // Legacy serialization preserved for DB-global duplicate detection.
  // Changing this would alter persisted idempotency behavior and skip semantics.
  const internalTransactionIdStr = `${transactionDate.getTime()}-${asset}-${amount}-${externalTransactionId}`;
  const internalTransactionId = Buffer.from(internalTransactionIdStr).toString(
    'base64'
  );
  return internalTransactionId;
}
