import { useRouter } from 'expo-router'
import * as Linking from 'expo-linking'
import { useEffect, useRef } from 'react'

import { parseInviteDeepLink } from '@/lib/auth/parse-invite-deep-link'
import { setPendingInviteToken } from '@/lib/auth/invite-token-store'

export function useInviteDeepLink(): void {
  const url = Linking.useURL()
  const router = useRouter()
  const handledUrl = useRef<string | null>(null)

  useEffect(() => {
    if (!url) return
    if (url === handledUrl.current) return

    const result = parseInviteDeepLink(url)
    if (result.type === 'none') return

    handledUrl.current = url
    setPendingInviteToken(result.token)
    router.replace('/sign-up')
  }, [url, router])
}
