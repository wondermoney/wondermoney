import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { grantableRoleSchema, type GrantableHouseholdRole, inviteEmailSchema, inviteHouseholdMemberEndpoint } from './household-contract'
import { householdKey } from './query-keys'

export type HouseholdInviteInput = Readonly<{ email: string; role: GrantableHouseholdRole }>

export function useInviteHouseholdMember() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useInviteHouseholdMember requires an authenticated runtime')
  const queryClient = useQueryClient()

  return useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: ({ email, role }: HouseholdInviteInput) => {
      const body = { email: inviteEmailSchema.parse(email), role: grantableRoleSchema.parse(role) }
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
