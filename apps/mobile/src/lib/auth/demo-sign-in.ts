import { type PairingSession, readSessionResponse } from './pairing'

/**
 * The public read-only demo: `POST /v1/auth/demo` signs in the server's one shared demo
 * account without a password. The answer is the same session hand-over QR pairing gets, so
 * the app adopts it the same way (see `features/auth/adopt-session.ts`).
 */

export type DemoSignInOutcome =
  | { session: PairingSession; status: 'signed-in' }
  /** 404: the operator has the demo turned off. */
  | { status: 'disabled' }
  /** 429: too many demo sign-ins from here. */
  | { status: 'rate-limited' }
  /** 503 (enabled but not set up), any other failure, or a body that isn't a session. */
  | { status: 'unavailable' }
  /** The request never reached the server. */
  | { status: 'unreachable' }

export async function requestDemoSession(
  baseUrl: string,
  deps: { appVersion: string; fetchImpl?: typeof fetch; platform?: string },
): Promise<DemoSignInOutcome> {
  const fetchImpl = deps.fetchImpl ?? fetch

  let response: Response
  try {
    response = await fetchImpl(`${baseUrl}/v1/auth/demo`, {
      body: '{}',
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

  if (response.status === 404) return { status: 'disabled' }
  if (response.status === 429) return { status: 'rate-limited' }
  if (!response.ok) return { status: 'unavailable' }

  const session = await readSessionResponse(response)
  return session ? { session, status: 'signed-in' } : { status: 'unavailable' }
}
