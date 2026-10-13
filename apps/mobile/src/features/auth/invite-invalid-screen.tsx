import { Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'

import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

export type InviteInvalidScreenProps = {
  onBackToSignIn: () => void
  onContinueWithoutInvite: () => void
}

/** Mirrors web's /join invalid-token state, adapted with a path back into normal sign-up
 * since mobile has no dedicated /join page — the invite flow lives inside /sign-up. */
export function InviteInvalidScreen({ onBackToSignIn, onContinueWithoutInvite }: InviteInvalidScreenProps) {
  const { t } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <View style={styles.panel}>
        <Text accessibilityRole="header" allowFontScaling style={[styles.title, { color: palette.foreground }]}>
          {t('auth.join.invalidTitle')}
        </Text>
        <Text allowFontScaling style={[styles.message, { color: palette.mutedForeground }]}>
          {t('auth.join.invalidBody')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('auth.join.continueWithoutInvite')}
          onPress={onContinueWithoutInvite}
          style={({ pressed }) => [styles.primaryButton, { backgroundColor: palette.primary }, pressed && styles.pressed]}
        >
          <Text allowFontScaling style={[styles.primaryButtonLabel, { color: palette.background }]}>
            {t('auth.join.continueWithoutInvite')}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('auth.join.backToSignIn')}
          onPress={onBackToSignIn}
          style={styles.link}
        >
          <Text allowFontScaling style={[styles.linkLabel, { color: palette.primary }]}>
            {t('auth.join.backToSignIn')}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, justifyContent: 'center' },
  panel: { width: '100%', maxWidth: 480, alignSelf: 'center', padding: themeTokens.spacing[4], gap: themeTokens.spacing[4] },
  title: { ...textStyles.title, fontWeight: '700' as const },
  message: { ...textStyles.body },
  primaryButton: {
    minHeight: themeTokens.touchTarget.minimum,
    borderRadius: themeTokens.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: themeTokens.spacing[2],
  },
  primaryButtonLabel: { ...textStyles.action, fontWeight: '700' as const },
  link: { minHeight: themeTokens.touchTarget.minimum, justifyContent: 'center', alignSelf: 'center' },
  linkLabel: { ...textStyles.action },
  pressed: { opacity: 0.72 },
})
