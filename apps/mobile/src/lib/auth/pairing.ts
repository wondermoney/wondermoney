import { getBetterAuthCookiePrefix } from './cookie-prefix'
import { checkServer, normalizeServerUrl } from '@/lib/server/server-connection'

/**
 * QR pairing: `wondermoney://pair?server=<API_URL>&code=<code>`.
 *
 * The payload holds no long-lived secret. The code is single-use and lives for two minutes;
 * the phone trades it for its own better-auth session, which the API returns as the signed
 * session-cookie value. Storing that value is what makes the app signed in — the app cannot
 * mint it, because it is signed with the server's secret.
 */

export const PAIRING_HOST = 'pair'

export type PairingPayload = Readonly<{ code: string; server: string }>

export type PairingSession = Readonly<{
  cookieName: string
  cookieValue: string
  expiresAt: string
}>

export type PairingOutcome =
  | { session: PairingSession; status: 'paired' }
  | { status: 'invalid-code' }
  | { status: 'not-wondermoney' }
  | { status: 'unreachable' }
  | { status: 'unavailable' }
  | { minAppVersion: string; status: 'update-required' }

/** `wondermoney://pair?server=…&code=…` to its parts, or null for anything else. */
export function parsePairingUrl(rawUrl: null | string | undefined): PairingPayload | null {
  if (!rawUrl) return null

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return null
  }

  if (parsed.protocol !== 'wondermoney:' || parsed.hostname !== PAIRING_HOST) return null

  const server = normalizeServerUrl(parsed.searchParams.get('server') ?? '')
  const code = parsed.searchParams.get('code')?.trim() ?? ''
  if (!server || code.length < 16) return null

  return { code, server }
}

/** Where `@better-auth/expo` keeps its cookie jar for this server's storage prefix. */
export function pairingCookieStorageKey(server: string): string {
  return `${getBetterAuthCookiePrefix(server) ?? 'better-auth'}_cookie`
}

/** The cookie jar the Expo client reads: one entry per cookie name. */
export function pairedCookieJar(session: PairingSession): string {
  return JSON.stringify({
    [session.cookieName]: { expires: session.expiresAt, value: session.cookieValue },
  })
}

export type PairingStorage = Readonly<{
  setItem: (key: string, value: string) => Promise<void>
}>

/** Persist the paired session where the better-auth Expo client will find it. */
export async function storePairedSession(
  server: string,
  session: PairingSession,
  storage: PairingStorage,
): Promise<void> {
  await storage.setItem(pairingCookieStorageKey(server), pairedCookieJar(session))
}

type PairingFetch = typeof fetch

/**
 * Validate the server, then exchange the code for a session.
 *
 * The server check comes first and is the same `/v1/instance` probe the sign-in screen uses,
 * so a QR from anywhere else is rejected before any credential is sent.
 */
export async function exchangePairingCode(
  payload: PairingPayload,
  deps: { appVersion: string; fetchImpl?: PairingFetch; platform?: string },
): Promise<PairingOutcome> {
  const fetchImpl = deps.fetchImpl ?? fetch

  const check = await checkServer(payload.server, { appVersion: deps.appVersion, fetchImpl })
  if (check.status === 'update-required') return { minAppVersion: check.minAppVersion, status: 'update-required' }
  if (check.status !== 'ok') return { status: check.status }

  let response: Response
  try {
    response = await fetchImpl(`${payload.server}/v1/auth/pair`, {
      body: JSON.stringify({ code: payload.code }),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': `WonderMoney/${deps.appVersion} (${deps.platform ?? 'mobile'})`,
      },
      method: 'POST',
    })
  } catch {
    return { status: 'unreachable' }
  }

  if (response.status === 404) return { status: 'invalid-code' }
  if (!response.ok) return { status: 'unavailable' }

  const session = await readSessionResponse(response)
  return session ? { session, status: 'paired' } : { status: 'unavailable' }
}

/**
 * The `{ session: { cookieName, cookieValue, expiresAt } }` body the API answers a session
 * hand-over with (`POST /v1/auth/pair`, `POST /v1/auth/demo`), or null when it is anything else.
 */
export async function readSessionResponse(response: Response): Promise<PairingSession | null> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return null
  }

  const session = (body as { session?: Partial<PairingSession> } | null)?.session
  if (
    !session
    || typeof session.cookieName !== 'string'
    || typeof session.cookieValue !== 'string'
    || typeof session.expiresAt !== 'string'
  ) {
    return null
  }

  return { cookieName: session.cookieName, cookieValue: session.cookieValue, expiresAt: session.expiresAt }
}
