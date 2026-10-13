import { Link, useLocalSearchParams } from 'expo-router'
import { Text, useColorScheme } from 'react-native'
import { useTranslation } from 'react-i18next'

import { usePasswordRecovery } from '@/components/providers/password-recovery-provider'
import { ForgotPasswordScreen } from '@/features/auth/forgot-password-screen'
import { themeTokens } from '@/theme/tokens'

export default function ForgotPasswordRoute() {
  const { t } = useTranslation()
  const { requestReset } = usePasswordRecovery()
  const params = useLocalSearchParams<{ notice?: string }>()
  const colorScheme = useColorScheme()
  const palette = themeTokens.colors[colorScheme === 'dark' ? 'dark' : 'light']
  return (
    <ForgotPasswordScreen
      notice={params.notice === 'expired' ? t('auth.errors.linkExpired') : undefined}
      onSubmit={async (email) => (await requestReset(email)).status}
      footer={<Link href="/sign-in"><Text style={{ color: palette.primary }}>{t('auth.forgotPassword.backToSignIn')}</Text></Link>}
    />
  )
}
