import type { AccountAccess } from './accounts-contract'

/**
 * Whether the caller may change an account and its transactions. Only `read` (a member the
 * account is shared with to view, or a household viewer) stops it; an account this build knows
 * nothing about stays writable, because the server enforces every write anyway.
 */
export const canWriteAccount = (account: { myAccess?: AccountAccess | null } | null | undefined): boolean => (
  account?.myAccess !== 'read'
)

/**
 * The accounts the caller can only view, by key, for a ledger whose rows name their account
 * (`accountKey`) and not its access.
 */
export const readOnlyAccountKeys = (
  accounts: readonly { accountKey: number; myAccess?: AccountAccess | null }[] | null | undefined,
): ReadonlySet<number> => new Set((accounts ?? []).filter((account) => !canWriteAccount(account)).map((account) => account.accountKey))
