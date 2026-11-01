// import { headers } from "next/headers";

import { getCookie } from "../cookies";

// export function getCountryCode() {
//   const countryCode = headers().get("x-vercel-ip-country") || "PT";

//   return countryCode;
// }

export function getCountryCodeClient() {
  const countryCode = getCookie("x-vercel-ip-country") || "PT";

  return countryCode;
}
