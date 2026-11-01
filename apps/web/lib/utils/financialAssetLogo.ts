// The ticker search/autocomplete endpoint returns no per-listing logo, and
// there's no EODHD logo source wired into the search response (the ticker info/fundamentals endpoints do carry a
// resolved `image` field, but that's a per-ticker call, not something we can
// fetch for every row of a live autocomplete dropdown), so fall back to the
// same generic ticker icon already used elsewhere for this exact case (see
// `FALLBACK_LOGO` in `lib/api/financial-markets/useTickerInfo.ts`).
export const getFinancialAssetLogo = (_ticker: string) => {
  return "/chart-candlestick.svg";
};
