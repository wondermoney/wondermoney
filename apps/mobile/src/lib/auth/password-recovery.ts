/**
 * Password recovery over the application-owned better-auth client.
 *
 * Request and confirm both go through the same injected client; there is no
 * second, throwaway client any more (better-auth's reset endpoints are
 * stateless and do not establish a session). The reset link is
 * `wondermoney://reset-password?token=…`, whose scheme and host are validated by
 * `parse-recovery-deep-link.ts` before the token ever reaches this adapter, and
 * the token itself is scope-checked here before it is sent.
 */

export const RESET_PASSWORD_REDIRECT_URL = 'wondermoney://reset-password'

export type RequestResetOutcome =
  | { status: 'sent' }
  | { status: 'rate-limited' }
  | { status: 'unavailable' }

export type ConfirmResetOutcome =
  | { status: 'accepted' }
  | { status: 'weak-password' }
  | { status: 'link-expired' }
  | { status: 'unavailable' }

export type PasswordRecoveryAdapter = Readonly<{
  requestReset: (email: string) => Promise<RequestResetOutcome>
  confirmReset: (token: string, newPassword: string) => Promise<ConfirmResetOutcome>
  /**
   * Drops any cached identity after a completed reset. better-auth rotates and
   * revokes sessions server-side on reset; this clears the persisted cookie and
   * cached session on the device so a stale token cannot be replayed.
   */
  clearCachedIdentity: () => Promise<void>
}>

export type PasswordRecoveryClientPort = Readonly<{
  requestPasswordReset: (input: { email: string; redirectTo: string }) => Promise<{ data: unknown; error: unknown | null }>
  resetPassword: (input: { newPassword: string; token: string }) => Promise<{ data: unknown; error: unknown | null }>
  signOut: () => Promise<{ error: unknown | null }>
}>

const ERROR_LIKE = (error: unknown): { status: unknown; error: unknown; code?: unknown } => (
  typeof error === 'object' && error !== null ? error as { status: unknown; error: unknown; code?: unknown } : { status: undefined, error: undefined }
)

const statusOf = (error: unknown): number | null => {
  const status = ERROR_LIKE(error).status
  return typeof status === 'number' ? status : null
}

const codeOf = (error: unknown): string | null => {
  const like = ERROR_LIKE(error)
  if (typeof like.code === 'string') return like.code
  const body = like.error
  if (typeof body === 'object' && body !== null) {
    const nested = (body as { code?: unknown }).code
    if (typeof nested === 'string') return nested
  }
  return null
}

const WEAK_PASSWORD_CODES = new Set(['PASSWORD_TOO_SHORT', 'PASSWORD_TOO_LONG'])
const EXPIRED_TOKEN_CODES = new Set(['INVALID_TOKEN', 'TOKEN_EXPIRED', 'INVALID_RESET_TOKEN'])

const MAX_RESET_TOKEN_LENGTH = 2048

/**
 * Reset tokens are opaque bearer material. Refuse anything that is empty,
 * oversized, or contains whitespace before it can be forwarded or logged.
 */
export const isPlausibleResetToken = (token: string): boolean => (
  token.length > 0
  && token.length <= MAX_RESET_TOKEN_LENGTH
  && !/\s/.test(token)
)

export function createPasswordRecoveryAdapter(
  client: PasswordRecoveryClientPort,
): PasswordRecoveryAdapter {
  return {
    requestReset: async (email) => {
      try {
        const { error } = await client.requestPasswordReset({ email, redirectTo: RESET_PASSWORD_REDIRECT_URL })
        if (error === null) return { status: 'sent' }
        return statusOf(error) === 429 ? { status: 'rate-limited' } : { status: 'unavailable' }
      } catch {
        return { status: 'unavailable' }
      }
    },

    confirmReset: async (token, newPassword) => {
      if (!isPlausibleResetToken(token)) return { status: 'link-expired' }
      try {
        const { error } = await client.resetPassword({ newPassword, token })
        if (error === null) {
          // Clear cached identity on reset completion; never fail the reset if
          // the local clear itself fails.
          try {
            await client.signOut()
          } catch {
            // best-effort
          }
          return { status: 'accepted' }
        }
        const code = codeOf(error)
        if (code !== null && EXPIRED_TOKEN_CODES.has(code)) return { status: 'link-expired' }
        if (code !== null && WEAK_PASSWORD_CODES.has(code)) return { status: 'weak-password' }
        return { status: 'unavailable' }
      } catch {
        return { status: 'unavailable' }
      }
    },

    clearCachedIdentity: async () => {
      try {
        await client.signOut()
      } catch {
        // best-effort
      }
    },
  }
}
