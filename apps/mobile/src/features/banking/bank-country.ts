import { getLocales } from 'expo-localization'

const VALID_COUNTRY_CODE = /^[A-Z]{2}$/

/**
 * Best-effort country hint for the institution picker (`GET
 * /v1/banking/bank?country=..`). `country` is optional server-side, so an
 * unresolved or malformed device region simply omits the param rather than
 * forwarding garbage upstream. Injectable `read` mirrors resolveSignupLocale
 * so this stays a pure, DI-testable function instead of needing to mock the
 * native module.
 */
export function resolveBankCountryCode(
  read: () => { regionCode: string | null }[] = getLocales,
): string | undefined {
  const region = read()[0]?.regionCode?.toUpperCase()
  return region && VALID_COUNTRY_CODE.test(region) ? region : undefined
}
