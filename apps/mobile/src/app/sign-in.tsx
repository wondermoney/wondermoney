import { Link, useLocalSearchParams } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { AuthLink, AuthLead } from '@/features/auth/auth-form-styles'
import { ScanPairingQr } from '@/features/auth/scan-pairing-qr'
import { ServerSwitcher } from '@/features/auth/server-switcher'
import { SignInScreen } from '@/features/auth/sign-in-screen'
import { SocialSignIn } from '@/features/auth/social-sign-in'
import { SsoSignIn } from '@/features/auth/sso-sign-in'
import { usePairing } from '@/features/auth/use-pairing'
import { Button } from '@/components/ui/button'
import { usePasswordSignIn } from '@/lib/server/use-instance'
import { captureAnalyticsEvent } from '@/lib/telemetry/analytics'

export default function SignInRoute() {
  const { t } = useTranslation()
  const { signInWithPassword, blockAccess, activationError, clearActivationError } = useProductRuntime()
  const params = useLocalSearchParams<{ notice?: string; pairCode?: string; pairServer?: string }>()
  const passwordUpdatedNotice = params.notice === 'passwordUpdated' ? t('auth.resetPassword.success') : undefined
  const provisionFailed = activationError === 'provision-failed'
  // OIDC_ONLY: the server takes no passwords, so single sign-on is the form.
  const passwordSignIn = usePasswordSignIn()

  const pairing = usePairing()
  const [scanning, setScanning] = useState(false)
  // The deep link arrives once per URL; a re-render must not exchange the code twice.
  const handledLink = useRef<string | null>(null)

  useEffect(() => {
    if (!params.pairServer || !params.pairCode) return
    const link = `${params.pairServer}|${params.pairCode}`
    if (handledLink.current === link) return
    handledLink.current = link
    void pairing.pair({ code: params.pairCode, server: params.pairServer })
  }, [params.pairCode, params.pairServer, pairing])

  const pairingNotice = (() => {
    switch (pairing.status) {
      case 'pairing':
        return { message: t('auth.pairing.connecting'), tone: 'default' as const }
      case 'invalid-code':
        return { message: t('auth.pairing.errors.invalidCode'), tone: 'destructive' as const }
      case 'not-wondermoney':
        return { message: t('auth.server.errors.notWonderMoney'), tone: 'destructive' as const }
      case 'unreachable':
        return { message: t('auth.server.errors.unreachable'), tone: 'destructive' as const }
      case 'update-required':
        return {
          message: t('auth.server.errors.updateRequired', { version: pairing.minAppVersion ?? '' }),
          tone: 'destructive' as const,
        }
      case 'unavailable':
        return { message: t('auth.pairing.errors.unavailable'), tone: 'destructive' as const }
      default:
        return undefined
    }
  })()

  const notice = provisionFailed
    ? { message: t('auth.errors.provisionFailed'), tone: 'destructive' as const }
    : pairingNotice ?? (passwordUpdatedNotice ? { message: passwordUpdatedNotice, tone: 'default' as const } : undefined)

  return (
    <>
      <SignInScreen
        notice={notice?.message}
        noticeTone={notice?.tone ?? 'default'}
        title={t('auth.welcomeBack')}
        lead={(
          <AuthLead
            link={<Link asChild href="/sign-up"><AuthLink label={t('auth.createAccountLink')} strong /></Link>}
            text={t('auth.notMember')}
          />
        )}
        forgotPasswordLink={<Link asChild href="/forgot-password"><AuthLink label={t('auth.forgotPasswordLink')} /></Link>}
        passwordSignIn={passwordSignIn}
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
            <SsoSignIn primary={!passwordSignIn} />
            <SocialSignIn />
            <Button
              label={t('auth.pairing.scanButton')}
              onPress={() => setScanning(true)}
              variant="outline"
            />
            <ServerSwitcher />
          </>
        )}
      />
      <ScanPairingQr
        onClose={() => setScanning(false)}
        onScanned={(payload) => {
          setScanning(false)
          void pairing.pair(payload)
        }}
        visible={scanning}
      />
    </>
  )
}
