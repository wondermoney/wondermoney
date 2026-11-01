import type { WebBrowserAuthSessionResult } from 'expo-web-browser'

export type BankConnectionResult = 'success' | 'error'

const APP_SCHEME = 'wondermoney:'
const RETURN_HOST = 'more'
const RETURN_PATH = '/banking'
const RESULT_PARAM = 'enableBankingConnection'

/**
 * Where the API's Enable Banking callback sends a connection the app started
 * (`returnTo=mobile`), with `?enableBankingConnection=success|error` appended.
 * The auth session closes when the browser reaches it.
 */
export const BANK_CONNECTION_RETURN_URL = `${APP_SCHEME}//${RETURN_HOST}${RETURN_PATH}`

function parseReturnLink(rawUrl: string | null | undefined): URL | null {
  if (!rawUrl) return null
  try {
    const parsed = new URL(rawUrl)
    const isReturnLink = parsed.protocol === APP_SCHEME && parsed.hostname === RETURN_HOST && parsed.pathname === RETURN_PATH
    return isReturnLink && parsed.searchParams.has(RESULT_PARAM) ? parsed : null
  } catch {
    return null
  }
}

/** True for the callback's return link, whatever outcome value it carries. */
export function isBankConnectionReturnUrl(rawUrl: string): boolean {
  return parseReturnLink(rawUrl) !== null
}

/**
 * The outcome carried by the callback's return link, or null when `rawUrl` is
 * not that link or carries no outcome this app knows. Scheme, host and path are
 * all checked, so another link that happens to carry the param is ignored.
 */
export function parseBankConnectionReturnUrl(rawUrl: string | null | undefined): BankConnectionResult | null {
  const link = parseReturnLink(rawUrl)
  return link ? parseBankConnectionResultParam(link.searchParams.get(RESULT_PARAM) ?? undefined) : null
}

/**
 * The outcome the auth session saw. A closed or cancelled session carries no
 * URL, so the outcome is unknown and the connections list finds out by polling.
 */
export function readBankConnectionResult(result: WebBrowserAuthSessionResult): BankConnectionResult | null {
  return result.type === 'success' ? parseBankConnectionReturnUrl(result.url) : null
}

/** The connections list route, with the marker and any known outcome. */
export function bankConnectionsHref(connection: BankConnectionResult | null) {
  return {
    pathname: '/more/banking',
    params: connection ? { justStarted: '1', connection } : { justStarted: '1' },
  } as const
}

/** Accepts only the two outcomes this app writes into the connections route's params. */
export function parseBankConnectionResultParam(value: string | string[] | undefined): BankConnectionResult | null {
  return value === 'success' || value === 'error' ? value : null
}
