import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { usePasskeyAvailable } from '@/lib/server/use-instance'
import { themeTokens } from '@/theme/tokens'

/**
 * "Sign in with a passkey", shown only where the phone will hand this app the server's passkeys
 * (`usePasskeyAvailable`: the server's passkey hostname is one of the build's associated
 * domains). Elsewhere, a self-hosted server included, it renders nothing and the other methods
 * remain. The session the server issues is picked up like any other sign-in; a passkey counts as
 * both factors, so there is no code to ask for. Closing the device's prompt is not an error.
 *
 * No analytics event: the telemetry ADR names the providers `sign_in_completed` may report.
 */
export function PasskeySignIn() {
  const { t } = useTranslation()
  const available = usePasskeyAvailable()
  const { signInWithPasskey } = useProductRuntime()
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  if (!available) return null

  const submit = async () => {
    if (pending) return
    setPending(true)
    setFailed(false)
    try {
      const outcome = await signInWithPasskey()
      if (outcome.status === 'unavailable') setFailed(true)
    } catch {
      setFailed(true)
    } finally {
      setPending(false)
    }
  }

  return (
    <View style={styles.group}>
      <Button
        block
        disabled={pending}
        label={pending ? t('auth.passkey.signingIn') : t('auth.passkey.signIn')}
        loading={pending}
        onPress={() => void submit()}
        variant="outline"
      />
      {failed ? (
        <Text accessible accessibilityRole="alert" tone="destructive" variant="meta">
          {t('auth.passkey.errors.unavailable')}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  group: { width: '100%', gap: themeTokens.spacing[3] },
})
