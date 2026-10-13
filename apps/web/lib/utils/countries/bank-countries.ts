/**
 * Countries offered in the "pick your bank's country" step when starting a
 * NEW bank connection (Enable Banking, BYOK — see plan §8/Task 2). These
 * values were originally sourced from GoCardless's coverage; GoCardless is
 * no longer used for new connections, but this list is kept as a static
 * selector option list because Enable Banking has no endpoint that returns
 * "every country with at least one bank" for the picker to query live
 * (`GET /aspsps` with no `country` filter returns the full ~2,700-institution
 * catalog, which is too large a payload to fetch just to populate a country
 * dropdown).
 *
 * Follow-up, not yet done: verify this list actually matches Enable
 * Banking's real per-country coverage (likely similar in scope to
 * GoCardless's — both advertise ~30 European countries — but not confirmed
 * identical).
 */
export const SUPPORTED_BANK_COUNTRY_CODES = [
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IS",
  "IE",
  "IT",
  "LV",
  "LI",
  "LT",
  "LU",
  "MT",
  "NL",
  "NO",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
  "GB",
];
