import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/ui/text'
import { SettingsSection } from '@/features/more/settings-ui'

import { SelfAction, type Palette } from '@/features/self/self-screen-parts'
import { themeTokens } from '@/theme/tokens'

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
    <SettingsSection title={t('security.appLock.heading')} description={t('security.appLock.helper')}>

      {!isLoaded ? (
        <Text accessibilityRole="progressbar" accessibilityLabel={t('security.appLock.loading')} variant="meta" tone="muted">
          {t('security.appLock.loading')}
        </Text>
      ) : (
        <View style={styles.row}>
          <Text variant="metaStrong">
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
            <Text accessibilityRole="alert" variant="meta" tone="destructive">
              {t(`security.appLock.errors.${failure}`)}
            </Text>
          ) : null}
        </View>
      )}
    </SettingsSection>
  )
}

const styles = StyleSheet.create({
  row: { gap: themeTokens.spacing[3], alignItems: 'flex-start' },
})
