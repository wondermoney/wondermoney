import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { createRemoveHouseholdMemberEndpoint } from './household-contract'
import { householdKey } from './query-keys'

/** Same endpoint for both directions: the owner removing the partner, or a member
 * removing themselves (leaving). Authorization is enforced server-side. */
export function useRemoveHouseholdMember() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useRemoveHouseholdMember requires an authenticated runtime')
  const queryClient = useQueryClient()

  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: (appuserKey: number) => runtime.apiClient.write(createRemoveHouseholdMemberEndpoint(appuserKey), {
      commit: () => {
        void queryClient.invalidateQueries({ queryKey: householdKey(runtime.epochId), exact: true })
      },
    }),
    onError: (error) => {
      if (!(error instanceof ApiError)) return
      if (error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
}
