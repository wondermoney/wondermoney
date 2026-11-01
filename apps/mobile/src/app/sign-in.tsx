import { Link, useLocalSearchParams } from 'expo-router'
import { Text, useColorScheme, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ServerSwitcher } from '@/features/auth/server-switcher'
import { SignInScreen } from '@/features/auth/sign-in-screen'
import { SocialSignIn } from '@/features/auth/social-sign-in'
import { captureAnalyticsEvent } from '@/lib/telemetry/analytics'
import { themeTokens } from '@/theme/tokens'

export default function SignInRoute() {
  const { t } = useTranslation()
  const { signInWithPassword, blockAccess, activationError, clearActivationError } = useProductRuntime()
  const params = useLocalSearchParams<{ notice?: string }>()
  const passwordUpdatedNotice = params.notice === 'passwordUpdated' ? t('auth.resetPassword.success') : undefined
  const colorScheme = useColorScheme()
  const palette = themeTokens.colors[colorScheme === 'dark' ? 'dark' : 'light']
  return (
    <SignInScreen
      notice={activationError === 'provision-failed' ? t('auth.errors.provisionFailed') : passwordUpdatedNotice}
      onSubmit={async (email, password) => {
        clearActivationError()
        const outcome = await signInWithPassword(email, password)
        if (outcome.status === 'mfa-pending') {
          // Password accepted, second factor outstanding. better-auth issues no
          // session yet, so there is nothing to activate; surface the existing
          // mfa-required access screen, whose challenge form verifies the code
          // and only then resumes activation.
          blockAccess('mfa-required')
          return 'mfa-pending'
        }
        // The channel only, never the address that was typed.
        if (outcome.status === 'accepted') captureAnalyticsEvent('sign_in_completed', { provider: 'email' })
        return outcome.status
      }}
      footer={
        <View style={{ gap: themeTokens.spacing[3] }}>
          <SocialSignIn />
          <Link href="/forgot-password"><Text style={{ color: palette.primary }}>{t('auth.forgotPasswordLink')}</Text></Link>
          <Link href="/sign-up"><Text style={{ color: palette.primary }}>{t('auth.noAccount')}</Text></Link>
          <ServerSwitcher />
        </View>
      }
    />
  )
}
