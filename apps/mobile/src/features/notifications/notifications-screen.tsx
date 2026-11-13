import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { SettingsNotice, SettingsPage, SettingsSection, SettingsSwitchRow } from '@/features/more/settings-ui'
import { SelfFailure, SelfLoading, SelfStaleBanner } from '@/features/self/self-screen-parts'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import type { NotificationRowViewModel, NotificationStream } from './notification-preferences-view-model'
import { PUSH_CATEGORIES, type PushCategory, type PushPreferencesDto } from './push-contract'
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

/** The push section, present only when the server has push on (`features.push`). */
export type PushSectionState = Readonly<{
  preferences: PushPreferencesDto | null
  saving: boolean
  failure: 'denied' | 'unavailable' | 'error' | null
  test: 'idle' | 'sending' | 'sent' | 'no-device' | 'error'
  onToggle: (category: PushCategory, next: boolean) => void
  onSendTest: () => void
}>

export type NotificationsScreenProps = {
  push?: PushSectionState
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
  push,
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
      {push ? <PushSection push={push} /> : null}
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

const PUSH_FAILURE_KEY = { denied: 'notifications.push.denied', unavailable: 'notifications.push.unavailable', error: 'notifications.push.saveError' } as const
const PUSH_TEST_KEY = { sent: 'notifications.push.testSent', 'no-device': 'notifications.push.testNoDevice', error: 'notifications.push.testError' } as const

function PushSection({ push }: { push: PushSectionState }) {
  const { t } = useTranslation()
  const palette = usePalette()
  const { preferences } = push
  return (
    <SettingsSection title={t('notifications.push.title')} description={t('notifications.push.description')} testID="push-notifications">
      {push.failure ? <SettingsNotice alert message={t(PUSH_FAILURE_KEY[push.failure])} tone={push.failure === 'error' ? 'destructive' : 'default'} /> : null}
      {preferences ? (
        <View style={[styles.list, { borderColor: palette.border }]}>
          {PUSH_CATEGORIES.map((category, index) => {
            const name = t(`notifications.push.${category}.title`)
            const checked = preferences[category]
            return (
              <SettingsSwitchRow
                key={category}
                accessibilityLabel={checked ? t('notifications.toggleOffLabel', { name }) : t('notifications.toggleOnLabel', { name })}
                description={t(`notifications.push.${category}.description`)}
                disabled={push.saving}
                onValueChange={(next) => push.onToggle(category, next)}
                separated={index > 0}
                title={name}
                value={checked}
              />
            )
          })}
        </View>
      ) : null}
      <Button
        label={push.test === 'sending' ? t('notifications.push.sendingTest') : t('notifications.push.sendTest')}
        loading={push.test === 'sending'}
        onPress={push.onSendTest}
        variant="outline"
        block
        testID="push-send-test"
      />
      {push.test === 'sent' || push.test === 'no-device' || push.test === 'error' ? (
        <Text accessibilityRole="alert" tone={push.test === 'error' ? 'destructive' : 'muted'} variant="meta">{t(PUSH_TEST_KEY[push.test])}</Text>
      ) : null}
      <Text tone="muted" variant="meta">{t('notifications.push.privacy')}</Text>
    </SettingsSection>
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
