// import { headers } from "next/headers";

import { getCookie } from "../cookies";
import { EU_COUNTRY_CODES } from "./countries";
import countries from "./countries.json";
import { countryFlags } from "./country-flag";

// export function getCountryCode() {
//   const countryCode = headers().get("x-vercel-ip-country") || "PT";

//   return countryCode;
// }

export function getCountryCodeClient() {
  const countryCode = getCookie("x-vercel-ip-country") || "PT";

  return countryCode;
}

export function getCountryInfo() {
  const country = getCountryCodeClient();

  const countryInfo = countries.find((x) => x.cca2 === country);

  const currencyCode =
    countryInfo && Object.keys(countryInfo.currencies)?.at(0);
  let currency;
  if (currencyCode && !Array.isArray(countryInfo?.currencies)) {
    currency =
      countryInfo?.currencies[
        currencyCode as keyof typeof countryInfo.currencies
      ];
  }
  const languages =
    countryInfo && Object.values(countryInfo.languages).join(", ");

  return {
    currencyCode,
    currency,
    languages,
  };
}

export function isEUCountry(countryCode: string) {
  if (EU_COUNTRY_CODES.includes(countryCode)) {
    return true;
  }

  return false;
}

export function getCountry() {
  const country = getCountryCodeClient();

  return countryFlags[country as keyof typeof countryFlags];
}
