/**
 * Countries offered in the "pick your bank's country" step when starting a
 * NEW bank connection (Enable Banking, BYOK). The list is static because
 * Enable Banking has no endpoint that returns
 * "every country with at least one bank" for the picker to query live
 * (`GET /aspsps` with no `country` filter returns the full ~2,700-institution
 * catalog, which is too large a payload to fetch just to populate a country
 * dropdown).
 *
 * Not yet verified against Enable Banking's real per-country coverage (it
 * advertises ~30 European countries, but the list is not confirmed identical).
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
