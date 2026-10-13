import { useTranslation } from 'react-i18next'
import { StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { SelfAction } from '@/features/self/self-screen-parts'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

export type AppLockScreenProps = Readonly<{
  pending: boolean
  failed: boolean
  onUnlock: () => void | Promise<void>
}>

export function AppLockScreen({ pending, failed, onUnlock }: AppLockScreenProps) {
  const { t } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <View style={styles.content}>
        <Text accessibilityRole="header" allowFontScaling style={[styles.title, { color: palette.foreground }]}>
          {t('appLock.title')}
        </Text>
        <Text allowFontScaling style={[styles.helper, { color: palette.mutedForeground }]}>
          {t('appLock.helper')}
        </Text>
        {failed ? (
          <Text accessibilityRole="alert" allowFontScaling style={[styles.error, { color: palette.destructive }]}>
            {t('appLock.failed')}
          </Text>
        ) : null}
        <SelfAction
          label={pending ? t('appLock.unlocking') : t('appLock.unlock')}
          onPress={onUnlock}
          palette={palette}
          primary
          disabled={pending}
        />
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[4] },
  title: { ...textStyles.title, fontWeight: '700' as const, textAlign: 'center' },
  helper: { ...textStyles.body, textAlign: 'center' },
  error: { ...textStyles.body, textAlign: 'center' },
})
