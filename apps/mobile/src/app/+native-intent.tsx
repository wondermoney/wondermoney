import { isBankConnectionReturnUrl, parseBankConnectionReturnUrl } from '@/features/banking/bank-connection-return'

/**
 * Rewrites links the OS hands the app before Expo Router routes them. Every link
 * except the bank connection return passes through unchanged.
 *
 * The bank connection return (`wondermoney://more/banking?enableBankingConnection=…`)
 * normally ends the auth session that opened bank consent, and that session's
 * handler navigates. On Android the same link also arrives here while the app is
 * running, so it is dropped to avoid a second navigation. When it starts the app
 * (the process was gone by the time consent finished), there is no session, so
 * it opens the connections list with the outcome.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string | null {
  if (!isBankConnectionReturnUrl(path)) return path
  if (!initial) return null
  const connection = parseBankConnectionReturnUrl(path)
  return connection ? `/more/banking?justStarted=1&connection=${connection}` : '/more/banking?justStarted=1'
}
