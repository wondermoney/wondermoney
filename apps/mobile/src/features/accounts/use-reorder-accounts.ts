import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { createReorderAccountsEndpoint, reorderAccountsWriteSchema } from './accounts-contract'
import { accountsKey } from './query-keys'

/**
 * Saves this member's account order. The order is per member, so it never changes what the
 * other household member sees; the list is refetched because the API places unordered and new
 * accounts after the ordered ones, by name.
 */
export function useReorderAccounts() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useReorderAccounts requires an authenticated runtime')
  const queryClient = useQueryClient()

  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: (accountIds: number[]) => {
      const body = reorderAccountsWriteSchema.parse({ accountIds })
      return runtime.apiClient.write(createReorderAccountsEndpoint(), {
        body,
        commit: () => {
          void queryClient.invalidateQueries({ queryKey: accountsKey(runtime.epochId), exact: true })
        },
      })
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
}
