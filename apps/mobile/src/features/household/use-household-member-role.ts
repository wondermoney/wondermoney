import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import {
  createUpdateHouseholdMemberRoleEndpoint,
  grantableRoleSchema,
  type GrantableHouseholdRole,
  transferHouseholdOwnershipEndpoint,
} from './household-contract'
import { householdKey } from './query-keys'

export type HouseholdRoleChange = Readonly<{ appuserKey: number; role: GrantableHouseholdRole }>

/**
 * The two writes that move roles: a manager's role change (PATCH a member) and the owner's
 * transfer of ownership (the old owner becomes an admin). Grouped like the invite actions.
 */
export function useHouseholdMemberRole() {
  const { runtime, blockAccess } = useProductRuntime()
  if (!runtime) throw new Error('useHouseholdMemberRole requires an authenticated runtime')
  const queryClient = useQueryClient()
  const key = householdKey(runtime.epochId)

  const onError = (error: unknown) => {
    if (!(error instanceof ApiError)) return
    if (error.code === 'mfa-required') blockAccess('mfa-required')
  }

  const changeRole = useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: ({ appuserKey, role }: HouseholdRoleChange) => runtime.apiClient.write(createUpdateHouseholdMemberRoleEndpoint(appuserKey), {
      body: { role: grantableRoleSchema.parse(role) },
      commit: () => {
        void queryClient.invalidateQueries({ queryKey: key, exact: true })
      },
    }),
    onError,
  })

  const transferOwnership = useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: (appuserKey: number) => runtime.apiClient.write(transferHouseholdOwnershipEndpoint, {
      body: { appuserKey },
      // The answer is the household after the change: show it now, then confirm with a refetch.
      commit: (household) => {
        queryClient.setQueryData(key, household)
        void queryClient.invalidateQueries({ queryKey: key, exact: true })
      },
    }),
    onError,
  })

  return { changeRole, transferOwnership }
}
