import { useRouter } from 'expo-router'
import * as Linking from 'expo-linking'
import { useEffect, useRef } from 'react'

import { parseRecoveryDeepLink } from '@/lib/auth/parse-recovery-deep-link'

import { setPendingRecoveryTokens } from './recovery-token-store'

export function useRecoveryDeepLink(): void {
  const url = Linking.useURL()
  const router = useRouter()
  const handledUrl = useRef<string | null>(null)

  useEffect(() => {
    if (!url) return
    if (url === handledUrl.current) return

    const result = parseRecoveryDeepLink(url)
    if (result.type === 'none') return

    handledUrl.current = url

    if (result.type === 'expired') {
      router.replace({ pathname: '/forgot-password', params: { notice: 'expired' } })
      return
    }

    setPendingRecoveryTokens({ token: result.token })
    router.replace('/reset-password')
  }, [url, router])
}
