export const getDefaultPortfolioCurrencyId = (
  currencies: { code: string; currencyKey: number }[] | undefined,
  userCurrencyCode?: string,
) => {
  if (userCurrencyCode) {
    return currencies?.find((c) => c.code === userCurrencyCode)?.currencyKey.toString();
  }

  return currencies?.find((c) => c.code === "EUR")?.currencyKey.toString();
};
