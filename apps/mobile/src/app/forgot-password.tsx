import { Link, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'

import { usePasswordRecovery } from '@/components/providers/password-recovery-provider'
import { AuthLink, AuthLead } from '@/features/auth/auth-form-styles'
import { ForgotPasswordScreen } from '@/features/auth/forgot-password-screen'

export default function ForgotPasswordRoute() {
  const { t } = useTranslation()
  const { requestReset } = usePasswordRecovery()
  const params = useLocalSearchParams<{ notice?: string }>()
  return (
    <ForgotPasswordScreen
      notice={params.notice === 'expired' ? t('auth.errors.linkExpired') : undefined}
      onSubmit={async (email) => (await requestReset(email)).status}
      lead={(
        <AuthLead
          link={<Link asChild href="/sign-up"><AuthLink label={t('auth.createAccountLink')} strong /></Link>}
          text={t('auth.notMember')}
        />
      )}
      footer={<Link asChild href="/sign-in"><AuthLink label={t('auth.forgotPassword.backToSignIn')} /></Link>}
    />
  )
}
