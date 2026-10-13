import { type Href, useRouter } from 'expo-router'

import { useProfile } from '@/features/self/use-self-resource'
import { ApiError } from '@/lib/api/errors'

import { HouseholdScreen, type HouseholdViewState } from './household-screen'
import { computeHouseholdViewModel } from './household-view-models'
import { useHousehold } from './use-household'
import { useHouseholdInviteActions } from './use-household-invite-actions'
import { useInviteHouseholdMember } from './use-invite-household-member'
import { useRemoveHouseholdMember } from './use-remove-household-member'

export function HouseholdRoute() {
  const router = useRouter()
  const household = useHousehold()
  const profile = useProfile()
  const invite = useInviteHouseholdMember()
  const { resend, revoke } = useHouseholdInviteActions()
  const removeMember = useRemoveHouseholdMember()

  const viewerEmail = profile.data?.profile.emailAddress
  let state: HouseholdViewState

  if (household.isAccessTransition || profile.isAccessTransition) state = { status: 'access-transition' }
  else if (household.isLoading || profile.isLoading) state = { status: 'loading' }
  else if (household.data && viewerEmail) {
    const data = computeHouseholdViewModel(household.data, viewerEmail)
    state = household.isRefreshFailure ? { status: 'refresh-error', data } : { status: 'loaded', data }
  } else if (
    (household.error instanceof ApiError && household.error.code === 'invalid-response')
    || (profile.error instanceof ApiError && profile.error.code === 'invalid-response')
  ) {
    state = { status: 'invalid-response' }
  } else state = { status: 'error' }

  const goBack = () => {
    if (router.canGoBack()) router.back()
    else router.replace('/more' as unknown as Href)
  }

  const removeTarget = state.status === 'loaded' || state.status === 'refresh-error'
    ? (state.data.isOwner ? state.data.partner : state.data.me)
    : null

  return (
    <HouseholdScreen
      state={state}
      onBack={goBack}
      onRetry={async () => { await Promise.all([household.refetch(), profile.refetch()]) }}
      onInvite={async (email) => { await invite.mutateAsync(email) }}
      invitePending={invite.isPending}
      onResendInvite={async () => {
        const key = household.data?.pendingInvite?.householdInviteKey
        if (key === undefined) return
        await resend.mutateAsync(key)
      }}
      resendPending={resend.isPending}
      onRevokeInvite={async () => {
        const key = household.data?.pendingInvite?.householdInviteKey
        if (key === undefined) return
        await revoke.mutateAsync(key)
      }}
      revokePending={revoke.isPending}
      onRemoveMember={async () => {
        if (!removeTarget) return
        await removeMember.mutateAsync(removeTarget.appuserKey)
      }}
      removePending={removeMember.isPending}
    />
  )
}
