/**
 * Generates an internal transaction ID based on the transaction date and amount, in base64 format.
 * @param transactionDate - The date of the transaction.
 * @param amount - The amount of the transaction.
 * @returns The generated internal transaction ID.
 */
export function generateInternalTransactionId(
  transactionDate: Date,
  amount: string | number
) {
  const internalTransactionIdStr = `${transactionDate.getTime()}-${amount}`;
  const internalTransactionId = Buffer.from(internalTransactionIdStr).toString(
    'base64'
  );
  return internalTransactionId;
}
