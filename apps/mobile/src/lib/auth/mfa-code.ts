const TOTP_CODE_PATTERN = /^\d{6}$/

/** Strips whitespace a user may paste in from an authenticator app or password manager. */
export function normalizeTotpCode(raw: string): string {
  return raw.replace(/\s+/g, '')
}

/** TOTP codes issued by authenticator apps are always six digits. */
export function isValidTotpCode(code: string): boolean {
  return TOTP_CODE_PATTERN.test(code)
}

const UNSEPARATED_BACKUP_CODE = /^[A-Za-z0-9]{10}$/

/**
 * better-auth issues backup codes as `abcde-12345` and compares them exactly (case included).
 * Whitespace from a paste is dropped, and a code typed without its hyphen gets it back; anything
 * else is sent as typed.
 */
export function normalizeBackupCode(raw: string): string {
  const compact = raw.replace(/\s+/g, '')
  return UNSEPARATED_BACKUP_CODE.test(compact) ? `${compact.slice(0, 5)}-${compact.slice(5)}` : compact
}
