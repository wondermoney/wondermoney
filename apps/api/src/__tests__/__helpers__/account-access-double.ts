/**
 * For controller and service tests that run on a mocked EntityManager: the account access checks
 * read the database directly (`services/account/account-access.ts`), so these tests replace them
 * with "everything visible and writable". The access rule itself is tested against a real database
 * (`tenant-filter.account-sharing.test.ts`, `account-write-guard.http.test.ts`).
 *
 *   vi.mock('@service/account/account-access', async (importOriginal) =>
 *     (await import('@app/__tests__/__helpers__/account-access-double')).allAccountsWritable(await importOriginal()));
 */
import type { Request } from 'express';

import type * as AccountAccess from '@service/account/account-access';

export function allAccountsWritable(actual: typeof AccountAccess): typeof AccountAccess {
  return {
    ...actual,
    accountActor: (req: Request) => ({ appuserKey: req.user?.appuserKey ?? 0, householdRole: req.householdRole, tenantKey: req.tenant?.tenantKey ?? 0 }),
    assertAccountsWritable: async () => undefined,
    assertAccountWritable: async () => undefined,
    assertTransactionsWritable: async () => undefined,
    assertTransactionWritable: async () => undefined,
    loadAccountAccess: async () => new Map(),
    loadSharedAccountKeys: async () => new Set(),
    onlyWritableTransactions: async (_em, transactions) => [...transactions],
  };
}
