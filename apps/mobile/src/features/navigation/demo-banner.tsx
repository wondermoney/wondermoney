import { useQuery } from '@tanstack/react-query'
import * as Linking from 'expo-linking'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useOptionalProductRuntime } from '@/components/providers/product-runtime-provider'
import { Text } from '@/components/ui/text'
import { isApprovedExternalDestination, selfHostingDocsUrl } from '@/features/more/link-policy'
import { profileKey } from '@/features/self/query-keys'
import { profileEndpoint } from '@/features/self/self-contracts'
import { requestSignUpAfterSignOut } from '@/lib/auth/sign-up-after-sign-out'
import { useSignupOpen } from '@/lib/server/use-instance'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

/**
 * True while the signed-in account is the server's shared demo (`profile.demo`). Reads the
 * same profile query the top bar does, so it costs no extra request; false while it loads,
 * when it fails, and on a server that predates the field. Call it only under a signed-in
 * runtime.
 */
export function useIsDemoAccount(): boolean {
  const runtime = useOptionalProductRuntime()?.runtime ?? null
  const { data } = useQuery({
    enabled: runtime !== null,
    queryKey: profileKey(runtime?.epochId ?? -1),
    queryFn: () => {
      if (!runtime) throw new Error('The demo check requires a signed-in runtime')
      return runtime.apiClient.read(profileEndpoint)
    },
    retry: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
  return runtime !== null && data?.profile.demo === true
}

/**
 * The strip under the top bar on every signed-in screen while the account is the demo: the
 * data is shared, read-only and reset daily. It offers a way to an own account (only when the
 * server takes sign-ups: the demo session is signed out first, since sign-up lives in the
 * signed-out tree) and the self-hosting guide.
 *
 * On flow routes there is no top bar, so the strip takes over the top safe area
 * (`ownsTopInset`); `(app)/_layout.tsx` tells the screens below it so.
 */
export function DemoBanner({ ownsTopInset }: { ownsTopInset: boolean }) {
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const signOut = useOptionalProductRuntime()?.signOut
  const signupOpen = useSignupOpen()

  const createAccount = () => {
    requestSignUpAfterSignOut()
    void signOut?.()
  }

  const openSelfHostingDocs = () => {
    const url = selfHostingDocsUrl(i18n.language)
    if (isApprovedExternalDestination(url)) void Linking.openURL(url)
  }

  return (
    <SafeAreaView
      edges={ownsTopInset ? ['top', 'left', 'right'] : ['left', 'right']}
      style={[styles.strip, { backgroundColor: palette.muted, borderBottomColor: palette.border }]}
      testID="demo-banner"
    >
      <Text variant="meta">{t('demo.banner.message')}</Text>
      <View style={styles.links}>
        {signupOpen ? <BannerLink label={t('demo.banner.signUp')} onPress={createAccount} /> : null}
        <BannerLink label={t('demo.banner.selfHost')} onPress={openSelfHostingDocs} />
      </View>
    </SafeAreaView>
  )
}

function BannerLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="link"
      // 20pt of text + 12pt above and below reaches the 44pt target.
      hitSlop={12}
      onPress={onPress}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <Text style={styles.linkText} tone="primary" variant="action">{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  strip: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: themeTokens.spacing[1],
    paddingHorizontal: themeTokens.layout.screenPadding,
    paddingVertical: themeTokens.spacing[2],
  },
  links: { columnGap: themeTokens.spacing[4], flexDirection: 'row', flexWrap: 'wrap', rowGap: themeTokens.spacing[2] },
  linkText: { textDecorationLine: 'underline' },
  pressed: { opacity: 0.7 },
})
