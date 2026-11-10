import { Link, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { AuthLink, AuthLead } from '@/features/auth/auth-form-styles'
import { ServerSwitcher } from '@/features/auth/server-switcher'
import { SignInScreen } from '@/features/auth/sign-in-screen'
import { SocialSignIn } from '@/features/auth/social-sign-in'
import { captureAnalyticsEvent } from '@/lib/telemetry/analytics'

export default function SignInRoute() {
  const { t } = useTranslation()
  const { signInWithPassword, blockAccess, activationError, clearActivationError } = useProductRuntime()
  const params = useLocalSearchParams<{ notice?: string }>()
  const passwordUpdatedNotice = params.notice === 'passwordUpdated' ? t('auth.resetPassword.success') : undefined
  const provisionFailed = activationError === 'provision-failed'
  return (
    <SignInScreen
      notice={provisionFailed ? t('auth.errors.provisionFailed') : passwordUpdatedNotice}
      noticeTone={provisionFailed ? 'destructive' : 'default'}
      title={t('auth.welcomeBack')}
      lead={(
        <AuthLead
          link={<Link asChild href="/sign-up"><AuthLink label={t('auth.createAccountLink')} strong /></Link>}
          text={t('auth.notMember')}
        />
      )}
      forgotPasswordLink={<Link asChild href="/forgot-password"><AuthLink label={t('auth.forgotPasswordLink')} /></Link>}
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
      footer={(
        <>
          <SocialSignIn />
          <ServerSwitcher />
        </>
      )}
    />
  )
}
