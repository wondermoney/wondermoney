import { type Href, useRouter } from 'expo-router'
import * as Linking from 'expo-linking'
import { useEffect, useRef } from 'react'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { parseInviteDeepLink } from '@/lib/auth/parse-invite-deep-link'
import { setPendingInviteToken } from '@/lib/auth/invite-token-store'
import { setJoinInviteToken } from '@/lib/auth/join-invite-token-store'

/** Where the join screen for a signed-in person lives (`app/(app)/settings/household/join`). */
export const HOUSEHOLD_JOIN_HREF = '/settings/household/join'

/**
 * `wondermoney://join?token=…`: signed out, the invite opens sign-up with the invited email
 * (a new account joins as it is created). Signed in, it opens the join confirmation, where the
 * person decides; nothing joins until they tap Join. While the session is still resolving
 * (a cold start from the link) the link waits for the outcome.
 */
export function useInviteDeepLink(): void {
  const url = Linking.useURL()
  const router = useRouter()
  const { routeState } = useProductRuntime()
  const handledUrl = useRef<string | null>(null)
  const status = routeState.status

  useEffect(() => {
    if (!url) return
    if (url === handledUrl.current) return

    const result = parseInviteDeepLink(url)
    if (result.type === 'none') return

    if (status === 'signed-out') {
      handledUrl.current = url
      setPendingInviteToken(result.token)
      router.replace('/sign-up')
      return
    }
    if (status === 'authenticated') {
      handledUrl.current = url
      setJoinInviteToken(result.token)
      router.replace(HOUSEHOLD_JOIN_HREF as Href)
    }
    // activating, deactivating, mfa-required, sign-out-failed: decide once it settles.
  }, [url, router, status])
}
