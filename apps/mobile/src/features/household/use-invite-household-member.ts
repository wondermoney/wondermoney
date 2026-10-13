import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { inviteEmailSchema, inviteHouseholdMemberEndpoint } from './household-contract'
import { householdKey } from './query-keys'

export function useInviteHouseholdMember() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useInviteHouseholdMember requires an authenticated runtime')
  const queryClient = useQueryClient()

  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: (email: string) => {
      const body = { email: inviteEmailSchema.parse(email) }
      return runtime.apiClient.write(inviteHouseholdMemberEndpoint, {
        body,
        commit: () => {
          void queryClient.invalidateQueries({ queryKey: householdKey(runtime.epochId), exact: true })
        },
      })
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return
      if (error.code === 'mfa-required') blockAccess('mfa-required')
    },
  })
}
