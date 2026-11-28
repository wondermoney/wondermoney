import { Link, useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { AuthLink, AuthLead } from '@/features/auth/auth-form-styles'
import { DemoSignIn } from '@/features/auth/demo-sign-in'
import { PasskeySignIn } from '@/features/auth/passkey-sign-in'
import { ScanPairingQr } from '@/features/auth/scan-pairing-qr'
import { ServerSetup } from '@/features/auth/server-setup'
import { ServerSwitcher } from '@/features/auth/server-switcher'
import { SignInScreen } from '@/features/auth/sign-in-screen'
import { SocialSignIn } from '@/features/auth/social-sign-in'
import { SsoSignIn } from '@/features/auth/sso-sign-in'
import { usePairing } from '@/features/auth/use-pairing'
import { Button } from '@/components/ui/button'
import { hasReturnAfterSignIn } from '@/lib/auth/return-after-sign-in'
import { takeSignUpAfterSignOut } from '@/lib/auth/sign-up-after-sign-out'
import { usePasswordSignIn, useServerSetup } from '@/lib/server/use-instance'

export default function SignInRoute() {
  const { t } = useTranslation()
  const { signInWithPassword, blockAccess, activationError, clearActivationError } = useProductRuntime()
  const params = useLocalSearchParams<{ notice?: string; pairCode?: string; pairServer?: string }>()
  const passwordUpdatedNotice = params.notice === 'passwordUpdated' ? t('auth.resetPassword.success') : undefined
  const provisionFailed = activationError === 'provision-failed'
  // OIDC_ONLY: the server takes no passwords, so single sign-on is the form.
  const passwordSignIn = usePasswordSignIn()
  // A server with no accounts yet has no one to sign in: it offers to be set up instead.
  const serverSetup = useServerSetup()

  // Signing out of the demo to create an account comes back through here (see
  // sign-up-after-sign-out.ts): carry on to sign-up.
  const router = useRouter()
  useEffect(() => {
    if (takeSignUpAfterSignOut()) router.replace('/sign-up')
  }, [router])

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

  // Signed out for a fresh session (lib/auth/return-after-sign-in.ts): say why, and that the
  // app goes back afterwards.
  const [signInAgain] = useState(hasReturnAfterSignIn)
  const notice = provisionFailed
    ? { message: t('auth.errors.provisionFailed'), tone: 'destructive' as const }
    : pairingNotice
      ?? (passwordUpdatedNotice ? { message: passwordUpdatedNotice, tone: 'default' as const } : undefined)
      ?? (signInAgain ? { message: t('auth.signInAgainNotice'), tone: 'default' as const } : undefined)

  if (serverSetup) return <ServerSetup server={serverSetup} />

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
          return outcome.status
        }}
        footer={(
          <>
            <SsoSignIn primary={!passwordSignIn} />
            <PasskeySignIn />
            <SocialSignIn />
            <DemoSignIn />
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
