export type InviteDeepLinkResult =
  | { type: 'invite'; token: string }
  | { type: 'none' }

const NONE: InviteDeepLinkResult = { type: 'none' }

/** Mirrors parse-recovery-deep-link's shape for `wondermoney://join?token=...` links. */
export function parseInviteDeepLink(rawUrl: string | null | undefined): InviteDeepLinkResult {
  if (!rawUrl) return NONE

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return NONE
  }

  if (parsed.hostname !== 'join') return NONE

  const token = parsed.searchParams.get('token')?.trim()
  return token ? { type: 'invite', token } : NONE
}
