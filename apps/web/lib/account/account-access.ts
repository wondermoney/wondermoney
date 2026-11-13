import type { AccountAccess } from "@/lib/api/account/useAccounts";

interface WithAccess {
  accountKey: number;
  myAccess?: AccountAccess;
}

/**
 * Whether the caller may change the account and its transactions. Only `read` (shared to view,
 * or a household viewer) says no; an account the client knows nothing about counts as
 * writable, because the API refuses the write anyway.
 */
export function canEditAccount(
  account: Pick<WithAccess, "myAccess"> | null | undefined,
): boolean {
  return account?.myAccess !== "read";
}

/** The accounts the caller may add or import transactions into. */
export function writableAccounts<T extends Pick<WithAccess, "myAccess">>(
  accounts: readonly T[],
): T[] {
  return accounts.filter(canEditAccount);
}

/**
 * The keys of the accounts the caller can only view, so a list of transactions can look each
 * row's account up by `accountKey` and leave the edit actions off its read-only rows.
 */
export function readOnlyAccountKeys(
  accounts: readonly WithAccess[] | null | undefined,
): ReadonlySet<number> {
  return new Set(
    (accounts ?? [])
      .filter((account) => !canEditAccount(account))
      .map((account) => account.accountKey),
  );
}
