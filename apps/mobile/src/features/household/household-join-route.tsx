import { type Href, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { takeJoinInviteToken } from '@/lib/auth/join-invite-token-store'

import { HouseholdJoinScreen, type HouseholdJoinInvite, type HouseholdJoinViewState } from './household-join-screen'
import { classifyAcceptInviteFailure, type AcceptInviteFailure } from './household-write-failures'
import { useAcceptHouseholdInvite } from './use-accept-household-invite'

type Validation =
  | { status: 'validating' }
  | { status: 'invalid' }
  | { status: 'unavailable' }
  | { status: 'ready'; invite: HouseholdJoinInvite }

/**
 * A signed-in person opened an invite link (`use-invite-deep-link`). The invite is checked with
 * the public validate endpoint, the confirmation names the household, and only the Join tap
 * accepts it. On success every query has been reset (`useAcceptHouseholdInvite`) and the
 * household page shows the new household.
 */
export function HouseholdJoinRoute() {
  const router = useRouter()
  const { validateHouseholdInvite } = useProductRuntime()
  const accept = useAcceptHouseholdInvite()
  const [token] = useState(() => takeJoinInviteToken())
  const [validation, setValidation] = useState<Validation>(() => (token ? { status: 'validating' } : { status: 'invalid' }))
  const [failure, setFailure] = useState<AcceptInviteFailure | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    void validateHouseholdInvite(token).then((outcome) => {
      if (cancelled) return
      if (outcome.status === 'valid') {
        setValidation({
          status: 'ready',
          invite: {
            email: outcome.invite.email,
            inviterName: outcome.invite.inviterName,
            householdName: outcome.invite.householdName ?? null,
            role: outcome.invite.role ?? 'member',
          },
        })
      } else setValidation({ status: outcome.status })
    })
    return () => { cancelled = true }
  }, [token, validateHouseholdInvite, attempt])

  const leave = useCallback(() => {
    if (router.canGoBack()) router.back()
    else router.replace('/' as Href)
  }, [router])

  const join = async () => {
    if (!token || accept.isPending) return
    setFailure(null)
    try {
      await accept.mutateAsync(token)
      router.replace('/settings/household' as Href)
    } catch (error) {
      setFailure(classifyAcceptInviteFailure(error))
    }
  }

  const state: HouseholdJoinViewState = validation.status === 'ready'
    ? { status: 'ready', invite: validation.invite, failure }
    : validation

  return (
    <HouseholdJoinScreen
      joining={accept.isPending}
      onCancel={leave}
      onJoin={() => void join()}
      onRetry={() => {
        setValidation({ status: 'validating' })
        setAttempt((value) => value + 1)
      }}
      state={state}
    />
  )
}
