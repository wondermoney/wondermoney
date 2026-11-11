import { isBankConnectionReturnUrl, parseBankConnectionReturnUrl } from '@/features/banking/bank-connection-return'
import { parsePairingUrl } from '@/lib/auth/pairing'

/**
 * Rewrites links the OS hands the app before Expo Router routes them. Every link
 * except the bank connection return and a pairing QR passes through unchanged.
 *
 * The bank connection return (`wondermoney://more/banking?enableBankingConnection=…`)
 * normally ends the auth session that opened bank consent, and that session's
 * handler navigates. On Android the same link also arrives here while the app is
 * running, so it is dropped to avoid a second navigation. When it starts the app
 * (the process was gone by the time consent finished), there is no session, so
 * it opens the connections list with the outcome.
 *
 * A pairing QR (`wondermoney://pair?server=…&code=…`) opens the sign-in screen with the
 * code, which exchanges it there. A malformed pair link still lands on sign-in rather than
 * an unmatched route, so the person sees the sign-in form instead of a dead end.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string | null {
  if (isPairingUrl(path)) {
    const pairing = parsePairingUrl(path)
    if (!pairing) return '/sign-in'
    const query = new URLSearchParams({ pairCode: pairing.code, pairServer: pairing.server })
    return `/sign-in?${query.toString()}`
  }
  if (!isBankConnectionReturnUrl(path)) return path
  if (!initial) return null
  const connection = parseBankConnectionReturnUrl(path)
  return connection ? `/more/banking?justStarted=1&connection=${connection}` : '/more/banking?justStarted=1'
}

function isPairingUrl(path: string): boolean {
  try {
    return new URL(path).hostname === 'pair'
  } catch {
    return false
  }
}
