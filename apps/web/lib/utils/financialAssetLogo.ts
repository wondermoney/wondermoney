// The ticker search/autocomplete endpoint (RAD-228's strict search DTO) never
// returned a per-listing logo, and the FMP image endpoint this used to build
// (`financialmodelingprep.com/image-stock/*`) was decommissioned in the
// RAD-449 EODHD migration — it was serving stale/dead images from a provider
// we no longer have credentials for. There's no EODHD equivalent wired into
// the search response (the ticker info/fundamentals endpoints do carry a
// resolved `image` field, but that's a per-ticker call, not something we can
// fetch for every row of a live autocomplete dropdown), so fall back to the
// same generic ticker icon already used elsewhere for this exact case (see
// `FALLBACK_LOGO` in `lib/api/financial-markets/useTickerInfo.ts`).
export const getFinancialAssetLogo = (_ticker: string) => {
  return "/chart-candlestick.svg";
};
