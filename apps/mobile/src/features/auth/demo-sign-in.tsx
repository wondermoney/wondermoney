import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { useConfirmedFeature } from '@/lib/server/use-instance'
import { themeTokens } from '@/theme/tokens'

import { type DemoSignInStatus, useDemoSignIn } from './use-demo-sign-in'

const failureKey: Partial<Record<DemoSignInStatus, string>> = {
  disabled: 'auth.demo.errors.disabled',
  'rate-limited': 'auth.demo.errors.rateLimited',
  unavailable: 'auth.demo.errors.unavailable',
  unreachable: 'auth.demo.errors.unreachable',
}

/**
 * "Try the demo" on the sign-in screen: one tap signs in to the server's shared read-only demo
 * account. Shown only once the connected server has said it offers the demo
 * (`features.demo`); a server that turns out to have it off (404) leaves the button disabled
 * with the reason under it.
 */
export function DemoSignIn() {
  const { t } = useTranslation()
  const offered = useConfirmedFeature((features) => features.demo)
  const { signIn, status } = useDemoSignIn()

  if (!offered) return null

  const pending = status === 'signing-in' || status === 'signed-in'
  const failure = failureKey[status]

  return (
    <View style={styles.block}>
      <Button
        block
        disabled={status === 'disabled'}
        label={pending ? t('auth.demo.signingIn') : t('auth.demo.button')}
        loading={pending}
        onPress={() => {
          if (pending) return
          void signIn()
        }}
        variant="outline"
      />
      {failure ? (
        <Text accessible accessibilityLabel={t(failure)} accessibilityRole="alert" tone="destructive" variant="meta">
          {t(failure)}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  block: { alignSelf: 'stretch', gap: themeTokens.spacing[2] },
})
