export type RecoveryDeepLinkResult =
  | { type: 'recovery'; token: string }
  | { type: 'expired' }
  | { type: 'none' }

const NONE: RecoveryDeepLinkResult = { type: 'none' }

/** The one scheme and host this parser will trust for a reset deep link. */
const RESET_SCHEME = 'wondermoney:'
const RESET_HOST = 'reset-password'

/**
 * Parses the better-auth password-reset deep link
 * (`wondermoney://reset-password?token=…`).
 *
 * Both the scheme and the host are checked: an attacker-supplied
 * `https://reset-password/…` or `wondermoney://attacker/…` link must never be
 * treated as a reset callback, because whatever token it carries would then be
 * submitted to the real reset endpoint.
 */
export function parseRecoveryDeepLink(rawUrl: string | null | undefined): RecoveryDeepLinkResult {
  if (!rawUrl) return NONE

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return NONE
  }

  if (parsed.protocol !== RESET_SCHEME || parsed.hostname !== RESET_HOST) return NONE

  if (parsed.searchParams.get('error')) return { type: 'expired' }

  const token = parsed.searchParams.get('token')
  return token ? { type: 'recovery', token } : NONE
}
