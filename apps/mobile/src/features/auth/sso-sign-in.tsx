import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { useOidcProvider } from '@/lib/server/use-instance'
import { themeTokens } from '@/theme/tokens'

/**
 * "Sign in with <name>" for a server with single sign-on (`features.oidc`). Opens the identity
 * provider in the same browser auth session the app uses for bank consent; the server returns
 * to the `wondermoney://auth/complete` deep link with the session. A two-factor account lands
 * on the existing TOTP challenge, exactly as after a password sign-in.
 *
 * When the provider refuses someone (not in an allowed group, unverified email, sign-up
 * closed), the reason is shown in that browser sheet; the app then only says the sign-in did
 * not finish. No analytics event is sent: the telemetry ADR names the providers it may report.
 */
export function SsoSignIn({ onBeforeSignIn, primary = false }: Readonly<{
  /** Runs right before the browser opens (the sign-up route re-arms a pending household invite). */
  onBeforeSignIn?: () => void
  /** The main action when the server takes no passwords (`OIDC_ONLY`). */
  primary?: boolean
}>) {
  const { t } = useTranslation()
  const provider = useOidcProvider()
  const { blockAccess, signInWithSso } = useProductRuntime()
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  if (!provider) return null

  const submit = async () => {
    if (pending) return
    setPending(true)
    setFailed(false)
    try {
      onBeforeSignIn?.()
      const outcome = await signInWithSso()
      if (outcome.status === 'mfa-pending') {
        // No session yet: the access screen's challenge form verifies the code, then resumes.
        blockAccess('mfa-required')
        return
      }
      if (outcome.status !== 'accepted') setFailed(true)
    } finally {
      setPending(false)
    }
  }

  return (
    <View style={styles.group}>
      {primary ? (
        <Text tone="muted" variant="meta">{t('auth.sso.onlyNotice', { provider: provider.name })}</Text>
      ) : null}
      <Button
        block
        label={pending ? t('auth.social.signingIn') : t('auth.sso.signIn', { provider: provider.name })}
        loading={pending}
        onPress={submit}
        variant={primary ? 'primary' : 'outline'}
      />
      {failed ? (
        <Text accessible accessibilityRole="alert" tone="destructive" variant="meta">
          {t('auth.sso.errors.unavailable', { provider: provider.name })}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  group: { width: '100%', gap: themeTokens.spacing[3] },
})
