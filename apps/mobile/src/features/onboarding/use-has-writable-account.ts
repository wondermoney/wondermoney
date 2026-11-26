import { useQuery } from '@tanstack/react-query'

import { type AuthEpochId, useProductRuntime } from '@/components/providers/product-runtime-provider'
import { canWriteAccount } from '@/features/accounts/account-access'
import { accountsEndpoint } from '@/features/accounts/accounts-contract'
import { accountsKey } from '@/features/accounts/query-keys'

const unauthenticatedEpochId = -1 as AuthEpochId

/**
 * Whether the person can already write to an account: a member who joined a household with a
 * shared account, say. Onboarding's "Import a statement" then imports into it, as web's
 * `StatementImportFlow` does, instead of creating an account first. False while the list loads
 * or fails, so the import falls back to the path that creates one.
 *
 * The accounts list's own query (`useAccounts`), shared through its key. Unlike `useAccounts`
 * it waits for the runtime instead of throwing, since the onboarding route renders on the frame
 * before it (see use-onboarding-bootstrap.ts).
 */
export function useHasWritableAccount(): boolean {
  const { runtime } = useProductRuntime()
  const query = useQuery({
    queryKey: accountsKey(runtime?.epochId ?? unauthenticatedEpochId),
    queryFn: () => {
      if (!runtime) throw new Error('useHasWritableAccount requires an authenticated runtime')
      return runtime.apiClient.read(accountsEndpoint)
    },
    enabled: !!runtime,
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
  return (query.data?.accounts ?? []).some(canWriteAccount)
}
