export const NEW_TRANSACTION_MERCHANT_PREFIX = "[NewMerchant]-";

export function normalizeTransactionMerchantName(name: string): string {
  return name.trim();
}

export function createNewMerchantSelection(
  name: string,
): { id: string; name: string } | null {
  const normalizedName = normalizeTransactionMerchantName(name);

  if (!normalizedName) {
    return null;
  }

  return {
    id: `${NEW_TRANSACTION_MERCHANT_PREFIX}${normalizedName}`,
    name: normalizedName,
  };
}
