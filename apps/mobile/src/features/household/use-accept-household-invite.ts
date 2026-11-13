import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { createAcceptHouseholdInviteEndpoint } from './household-contract'

/**
 * The signed-in person's "Join" on an invite. On success they belong to another household, so
 * every cached query (accounts, budgets, the household itself) is reset and refetched.
 */
export function useAcceptHouseholdInvite() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useAcceptHouseholdInvite requires an authenticated runtime')
  const queryClient = useQueryClient()

  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: (token: string) => runtime.apiClient.write(createAcceptHouseholdInviteEndpoint(token), {
      commit: () => {
        void queryClient.resetQueries()
      },
    }),
    onError: (error) => {
      if (!(error instanceof ApiError)) return
      if (error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
}
