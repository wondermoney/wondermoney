import { type Href, useRouter } from 'expo-router'

import { useProfile } from '@/features/self/use-self-resource'
import { ApiError } from '@/lib/api/errors'

import { HouseholdScreen, type HouseholdViewState } from './household-screen'
import { computeHouseholdViewModel } from './household-view-models'
import { useHousehold } from './use-household'
import { useHouseholdInviteActions } from './use-household-invite-actions'
import { useHouseholdMemberRole } from './use-household-member-role'
import { useInviteHouseholdMember } from './use-invite-household-member'
import { useRemoveHouseholdMember } from './use-remove-household-member'

export function HouseholdRoute() {
  const router = useRouter()
  const household = useHousehold()
  const profile = useProfile()
  const invite = useInviteHouseholdMember()
  const { resend, revoke } = useHouseholdInviteActions()
  const { changeRole, transferOwnership } = useHouseholdMemberRole()
  const removeMember = useRemoveHouseholdMember()

  const viewerEmail = profile.data?.profile.emailAddress
  // An API that names the viewer needs no profile to find "me"; an older one is matched by email.
  const knowsViewer = household.data?.viewerAppuserKey != null
  let state: HouseholdViewState

  if (household.isAccessTransition || profile.isAccessTransition) state = { status: 'access-transition' }
  else if (household.isLoading || (!knowsViewer && profile.isLoading)) state = { status: 'loading' }
  else if (household.data && (knowsViewer || viewerEmail)) {
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

  const me = state.status === 'loaded' || state.status === 'refresh-error' ? state.data.me : null

  return (
    <HouseholdScreen
      state={state}
      onBack={goBack}
      onRetry={async () => { await Promise.all([household.refetch(), profile.refetch()]) }}
      onInvite={async (email, role) => { await invite.mutateAsync({ email, role }) }}
      invitePending={invite.isPending}
      onResendInvite={async (key) => { await resend.mutateAsync(key) }}
      resendPending={resend.isPending}
      onRevokeInvite={async (key) => { await revoke.mutateAsync(key) }}
      revokePending={revoke.isPending}
      onChangeRole={async (appuserKey, role) => { await changeRole.mutateAsync({ appuserKey, role }) }}
      changeRolePending={changeRole.isPending}
      onTransferOwnership={async (appuserKey) => { await transferOwnership.mutateAsync(appuserKey) }}
      transferPending={transferOwnership.isPending}
      onRemoveMember={async (appuserKey) => {
        if (appuserKey === me?.appuserKey) return
        await removeMember.mutateAsync({ appuserKey, leaving: false })
      }}
      removePending={removeMember.isPending && removeMember.variables?.leaving === false}
      onLeave={async () => {
        if (!me) return
        await removeMember.mutateAsync({ appuserKey: me.appuserKey, leaving: true })
      }}
      leavePending={removeMember.isPending && removeMember.variables?.leaving === true}
    />
  )
}
