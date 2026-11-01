import { Link, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Text, useColorScheme, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { InviteInvalidScreen } from '@/features/auth/invite-invalid-screen'
import { SignUpScreen } from '@/features/auth/sign-up-screen'
import { SocialSignIn } from '@/features/auth/social-sign-in'
import type { InviteValidationDto } from '@/lib/auth/household-invite-validation'
import { setPendingInviteToken, takePendingInviteToken } from '@/lib/auth/invite-token-store'
import { captureAnalyticsEvent } from '@/lib/telemetry/analytics'
import { themeTokens } from '@/theme/tokens'

type InviteState =
  | { status: 'none' }
  | { status: 'validating' }
  | { status: 'valid'; token: string; invite: InviteValidationDto }
  | { status: 'invalid' }

export default function SignUpRoute() {
  const { t } = useTranslation()
  const { signUp, validateHouseholdInvite } = useProductRuntime()
  const router = useRouter()
  const [pendingToken] = useState(() => takePendingInviteToken())
  const [invite, setInvite] = useState<InviteState>(() => (pendingToken ? { status: 'validating' } : { status: 'none' }))
  const colorScheme = useColorScheme()
  const palette = themeTokens.colors[colorScheme === 'dark' ? 'dark' : 'light']

  useEffect(() => {
    if (!pendingToken) return
    let cancelled = false
    void validateHouseholdInvite(pendingToken).then((outcome) => {
      if (cancelled) return
      setInvite(outcome.status === 'valid'
        ? { status: 'valid', token: pendingToken, invite: outcome.invite }
        : { status: 'invalid' })
    })
    return () => { cancelled = true }
  }, [pendingToken, validateHouseholdInvite])

  if (invite.status === 'validating') {
    return (
      <View accessibilityRole="progressbar" accessibilityLabel={t('auth.join.validating')} style={{ flex: 1 }} />
    )
  }

  if (invite.status === 'invalid') {
    return (
      <InviteInvalidScreen
        onBackToSignIn={() => router.replace('/sign-in')}
        onContinueWithoutInvite={() => setInvite({ status: 'none' })}
      />
    )
  }

  const greeting = invite.status === 'valid'
    ? (invite.invite.inviterName
      ? t('auth.join.greetingNamed', { name: invite.invite.inviterName })
      : t('auth.join.greetingGeneric'))
    : undefined

  return (
    <SignUpScreen
      emailLocked={invite.status === 'valid'}
      greeting={greeting}
      initialEmail={invite.status === 'valid' ? invite.invite.email : undefined}
      onSubmit={async (email, password) => {
        if (invite.status === 'valid') setPendingInviteToken(invite.token)
        const outcome = await signUp(email, password)
        // The channel only. Never the address, and never whether an
        // invite was involved, which would leak household membership.
        if (outcome.status === 'accepted') captureAnalyticsEvent('sign_up_completed', { provider: 'email' })
        return outcome.status
      }}
      footer={(
        <View style={{ gap: themeTokens.spacing[3] }}>
          <SocialSignIn
            flow="sign_up"
            onBeforeSignIn={() => {
              if (invite.status === 'valid') setPendingInviteToken(invite.token)
            }}
          />
          <Link href="/sign-in"><Text style={{ color: palette.primary }}>{t('auth.haveAccount')}</Text></Link>
        </View>
      )}
    />
  )
}
