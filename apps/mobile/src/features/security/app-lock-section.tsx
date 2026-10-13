import { useTranslation } from 'react-i18next'
import { StyleSheet, Text, View } from 'react-native'

import { SelfAction, type Palette } from '@/features/self/self-screen-parts'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

export type AppLockFailure = 'no-hardware' | 'not-enrolled' | 'auth-failed'

export type AppLockSectionProps = Readonly<{
  isLoaded: boolean
  enabled: boolean
  pending: boolean
  failure: AppLockFailure | null
  onTurnOn: () => void | Promise<void>
  onTurnOff: () => void | Promise<void>
  palette: Palette
}>

export function AppLockSection({ isLoaded, enabled, pending, failure, onTurnOn, onTurnOff, palette }: AppLockSectionProps) {
  const { t } = useTranslation()
  return (
    <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.muted }]}>
      <Text accessibilityRole="header" allowFontScaling style={[styles.cardTitle, { color: palette.foreground }]}>
        {t('security.appLock.heading')}
      </Text>
      <Text allowFontScaling style={[styles.cardBody, { color: palette.mutedForeground }]}>
        {t('security.appLock.helper')}
      </Text>

      {!isLoaded ? (
        <Text accessibilityRole="progressbar" accessibilityLabel={t('security.appLock.loading')} allowFontScaling style={[styles.cardBody, { color: palette.mutedForeground }]}>
          {t('security.appLock.loading')}
        </Text>
      ) : (
        <View style={styles.row}>
          <Text allowFontScaling style={[styles.statusLabel, { color: palette.foreground }]}>
            {t(enabled ? 'security.appLock.onLabel' : 'security.appLock.offLabel')}
          </Text>
          <SelfAction
            label={enabled
              ? t(pending ? 'security.appLock.turningOff' : 'security.appLock.turnOff')
              : t(pending ? 'security.appLock.turningOn' : 'security.appLock.turnOn')}
            onPress={enabled ? onTurnOff : onTurnOn}
            disabled={pending}
            palette={palette}
          />
          {failure ? (
            <Text accessibilityRole="alert" allowFontScaling style={[styles.error, { color: palette.destructive }]}>
              {t(`security.appLock.errors.${failure}`)}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: themeTokens.radius.lg,
    padding: themeTokens.spacing[4],
    gap: themeTokens.spacing[3],
  },
  cardTitle: { ...textStyles.section },
  cardBody: { ...textStyles.body },
  row: { gap: themeTokens.spacing[3], alignItems: 'flex-start' },
  statusLabel: { ...textStyles.action },
  error: { ...textStyles.body },
})
