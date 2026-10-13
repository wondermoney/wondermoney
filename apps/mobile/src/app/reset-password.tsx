import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'

import { usePasswordRecovery } from '@/components/providers/password-recovery-provider'
import { takePendingRecoveryTokens } from '@/features/auth/recovery-token-store'
import { ResetPasswordScreen } from '@/features/auth/reset-password-screen'

export default function ResetPasswordRoute() {
  const router = useRouter()
  const { confirmReset } = usePasswordRecovery()
  const [tokens] = useState(() => takePendingRecoveryTokens())

  useEffect(() => {
    if (!tokens) router.replace('/forgot-password')
  }, [router, tokens])

  if (!tokens) return null

  return (
    <ResetPasswordScreen
      onSubmit={async (newPassword) => {
        const outcome = await confirmReset(tokens.token, newPassword)
        if (outcome.status === 'accepted') {
          router.replace({ pathname: '/sign-in', params: { notice: 'passwordUpdated' } })
        }
        if (outcome.status === 'link-expired') {
          router.replace({ pathname: '/forgot-password', params: { notice: 'expired' } })
        }
        return outcome.status
      }}
    />
  )
}
