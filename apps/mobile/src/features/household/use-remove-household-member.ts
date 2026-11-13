import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { createRemoveHouseholdMemberEndpoint } from './household-contract'
import { householdKey } from './query-keys'

export type HouseholdRemoval = Readonly<{ appuserKey: number; leaving: boolean }>

/** Same endpoint for both directions: a manager removing a member, or a member removing
 * themselves (leaving). Authorization is enforced server-side. Someone who leaves has no
 * household until they sign in again (signing in gives them their own back), so leaving ends
 * with the app's normal sign-out. */
export function useRemoveHouseholdMember() {
  const { runtime, blockAccess, signOut } = useProductRuntime()
  if (!runtime) throw new Error('useRemoveHouseholdMember requires an authenticated runtime')
  const queryClient = useQueryClient()

  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: ({ appuserKey, leaving }: HouseholdRemoval) => runtime.apiClient.write(createRemoveHouseholdMemberEndpoint(appuserKey), {
      commit: () => {
        if (!leaving) void queryClient.invalidateQueries({ queryKey: householdKey(runtime.epochId), exact: true })
      },
    }),
    onSuccess: (_value, { leaving }) => {
      if (leaving) void signOut()
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return
      if (error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
}
