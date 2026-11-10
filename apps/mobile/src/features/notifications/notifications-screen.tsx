import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/ui/text'
import { SettingsNotice, SettingsPage, SettingsSection, SettingsSwitchRow } from '@/features/more/settings-ui'
import { SelfFailure, SelfLoading, SelfStaleBanner } from '@/features/self/self-screen-parts'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import type { NotificationRowViewModel, NotificationStream } from './notification-preferences-view-model'
import type { UpdateNotificationFailure } from './use-notification-preferences'

export type NotificationsViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'access-transition' }
  | {
      status: 'loaded'
      rows: readonly NotificationRowViewModel[]
      marketingOptOut: boolean
      refreshFailed: boolean
      refreshing: boolean
    }

export type NotificationsScreenProps = {
  state: NotificationsViewState
  saving: boolean
  saveFailure: UpdateNotificationFailure | null
  onBack: () => void
  onRetry: () => void | Promise<void>
  onLogout: () => void | Promise<void>
  onToggleStream: (stream: NotificationStream, next: boolean) => void
  onToggleMarketingOptOut: (next: boolean) => void
}

export function NotificationsScreen({
  state,
  saving,
  saveFailure,
  onBack,
  onRetry,
  onLogout,
  onToggleStream,
  onToggleMarketingOptOut,
}: NotificationsScreenProps) {
  const { t } = useTranslation()
  const palette = usePalette()

  if (state.status === 'access-transition') return null
  if (state.status === 'loading') {
    return <SelfLoading label={t('notifications.loading')} backLabel={t('self.back')} onBack={onBack} palette={palette} section="notifications" />
  }
  if (state.status === 'error') {
    return (
      <SelfFailure
        title={t('notifications.loadError.title')}
        message={t('notifications.loadError.description')}
        backLabel={t('self.back')}
        retryLabel={t('notifications.retry')}
        signOutLabel={t('common.signOut')}
        onBack={onBack}
        onRetry={onRetry}
        onLogout={onLogout}
        palette={palette}
        section="notifications"
      />
    )
  }

  return (
    <SettingsPage backLabel={t('self.back')} onBack={onBack} section="notifications">
      <SettingsSection first title={t('notifications.title')} description={t('notifications.description')}>
        {state.refreshFailed ? (
          <SelfStaleBanner
            message={t('notifications.refreshWarning.description')}
            retryLabel={t('notifications.retry')}
            refreshing={state.refreshing}
            onRetry={onRetry}
          />
        ) : null}
        {saving ? <Text accessibilityRole="alert" tone="muted" variant="label">{t('notifications.saving')}</Text> : null}
        {saveFailure ? <SettingsNotice alert message={t('notifications.saveError')} tone="destructive" /> : null}

        <View style={[styles.list, { borderColor: palette.border }]}>
          {state.rows.map((row, index) => (
            <StreamToggleRow
              key={row.stream}
              row={row}
              disabled={saving || !row.view.canChange}
              separated={index > 0}
              onToggle={(next) => onToggleStream(row.stream, next)}
            />
          ))}
        </View>

        <View style={[styles.list, { borderColor: palette.border }]}>
          <MarketingOptOutRow optedOut={state.marketingOptOut} disabled={saving} onToggle={onToggleMarketingOptOut} />
        </View>

        <Text tone="muted" variant="meta">{t('notifications.dataContext')}</Text>
      </SettingsSection>
    </SettingsPage>
  )
}

function StreamToggleRow({ row, disabled, separated, onToggle }: {
  row: NotificationRowViewModel
  disabled: boolean
  separated: boolean
  onToggle: (next: boolean) => void
}) {
  const { t } = useTranslation()
  const name = t(`notifications.${row.stream}.title`)
  const checked = row.storedEnabled
  return (
    <SettingsSwitchRow
      accessibilityLabel={checked ? t('notifications.toggleOffLabel', { name }) : t('notifications.toggleOnLabel', { name })}
      description={t(`notifications.${row.stream}.description`)}
      disabled={disabled}
      onValueChange={onToggle}
      separated={separated}
      title={name}
      value={checked}
    >
      <Text tone="muted" variant="meta">{t(`notifications.${row.stream}.detail`)}</Text>
      {row.view.status === 'paused' ? (
        <View accessibilityRole="text" style={styles.statusLine}>
          <Text tone="warning" variant="metaStrong">{t(`notifications.status.${row.view.status}`)}</Text>
          {row.view.pauseReason ? (
            <Text tone="muted" variant="meta">{t(`notifications.pauseReason.${row.view.pauseReason}`)}</Text>
          ) : null}
        </View>
      ) : null}
    </SettingsSwitchRow>
  )
}

function MarketingOptOutRow({ optedOut, disabled, onToggle }: {
  optedOut: boolean
  disabled: boolean
  onToggle: (next: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <SettingsSwitchRow
      accessibilityLabel={optedOut ? t('notifications.marketingOptOut.toggleOffLabel') : t('notifications.marketingOptOut.toggleOnLabel')}
      description={t('notifications.marketingOptOut.description')}
      disabled={disabled}
      onValueChange={onToggle}
      title={t('notifications.marketingOptOut.title')}
      value={optedOut}
    />
  )
}

// One subtle rounded group per run of switches (the settings list's `SettingsGroup` box), hairlines between rows.
const styles = StyleSheet.create({
  list: { borderWidth: 1, borderRadius: themeTokens.radius.xl, paddingHorizontal: themeTokens.spacing[4] },
  statusLine: { gap: themeTokens.spacing[1], marginTop: themeTokens.spacing[1] },
})
