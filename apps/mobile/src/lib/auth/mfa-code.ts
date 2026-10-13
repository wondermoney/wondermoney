const TOTP_CODE_PATTERN = /^\d{6}$/

/** Strips whitespace a user may paste in from an authenticator app or password manager. */
export function normalizeTotpCode(raw: string): string {
  return raw.replace(/\s+/g, '')
}

/** TOTP codes issued by authenticator apps are always six digits. */
export function isValidTotpCode(code: string): boolean {
  return TOTP_CODE_PATTERN.test(code)
}
