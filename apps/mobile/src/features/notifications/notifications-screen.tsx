import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BackControl } from '@/components/ui/back-control'
import { PageHeader } from '@/components/ui/page-header'
import { SelfFailure, SelfLoading, SelfStaleBanner, selfStyles, type Palette } from '@/features/self/self-screen-parts'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

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
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']

  if (state.status === 'access-transition') return null
  if (state.status === 'loading') {
    return <SelfLoading label={t('notifications.loading')} backLabel={t('self.back')} onBack={onBack} palette={palette} />
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
      />
    )
  }

  return (
    <SafeAreaView style={[selfStyles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={selfStyles.content}>
        <View style={selfStyles.page}>
          <BackControl fallback="/more" label={t('self.back')} onPress={onBack} />

          {state.refreshFailed ? (
            <SelfStaleBanner
              message={t('notifications.refreshWarning.description')}
              retryLabel={t('notifications.retry')}
              refreshing={state.refreshing}
              onRetry={onRetry}
              palette={palette}
            />
          ) : null}

          <PageHeader palette={palette}
            instruction={t('notifications.description')} title={t('notifications.title')} />

          {saving ? (
            <Text accessibilityRole="alert" allowFontScaling style={[styles.saving, { color: palette.mutedForeground }]}>{t('notifications.saving')}</Text>
          ) : null}
          {saveFailure ? (
            <View accessible accessibilityRole="alert" style={[styles.banner, { borderColor: palette.destructive, backgroundColor: palette.muted }]}>
              <Text allowFontScaling style={[styles.bannerText, { color: palette.foreground }]}>{t('notifications.saveError')}</Text>
            </View>
          ) : null}

          <View style={[styles.list, { borderColor: palette.border }]}>
            {state.rows.map((row, index) => (
              <StreamToggleRow
                key={row.stream}
                row={row}
                disabled={saving || !row.view.canChange}
                separated={index > 0}
                onToggle={(next) => onToggleStream(row.stream, next)}
                palette={palette}
              />
            ))}
          </View>

          <View style={[styles.list, { borderColor: palette.border }]}>
            <MarketingOptOutRow
              optedOut={state.marketingOptOut}
              disabled={saving}
              onToggle={onToggleMarketingOptOut}
              palette={palette}
            />
          </View>

          <Text allowFontScaling style={[selfStyles.helper, { color: palette.mutedForeground }]}>{t('notifications.dataContext')}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function StreamToggleRow({ row, disabled, separated, onToggle, palette }: {
  row: NotificationRowViewModel
  disabled: boolean
  separated: boolean
  onToggle: (next: boolean) => void
  palette: Palette
}) {
  const { t } = useTranslation()
  const name = t(`notifications.${row.stream}.title`)
  const checked = row.storedEnabled
  return (
    <View style={[styles.row, separated && { borderTopWidth: 1, borderTopColor: palette.border }]}>
      <View style={styles.rowText}>
        <Text allowFontScaling style={[styles.rowTitle, { color: palette.foreground }]}>{name}</Text>
        <Text allowFontScaling style={[styles.rowDescription, { color: palette.mutedForeground }]}>{t(`notifications.${row.stream}.description`)}</Text>
        <Text allowFontScaling style={[styles.rowDetail, { color: palette.mutedForeground }]}>{t(`notifications.${row.stream}.detail`)}</Text>
        {row.view.status === 'paused' ? (
          <View accessibilityRole="text" style={styles.statusLine}>
            <Text allowFontScaling style={[styles.status, { color: palette.warningText }]}>{t(`notifications.status.${row.view.status}`)}</Text>
            {row.view.pauseReason ? (
              <Text allowFontScaling style={[styles.pauseReason, { color: palette.mutedForeground }]}>{t(`notifications.pauseReason.${row.view.pauseReason}`)}</Text>
            ) : null}
          </View>
        ) : null}
      </View>
      <Toggle
        checked={checked}
        disabled={disabled}
        label={checked ? t('notifications.toggleOffLabel', { name }) : t('notifications.toggleOnLabel', { name })}
        onToggle={onToggle}
        palette={palette}
      />
    </View>
  )
}

function MarketingOptOutRow({ optedOut, disabled, onToggle, palette }: {
  optedOut: boolean
  disabled: boolean
  onToggle: (next: boolean) => void
  palette: Palette
}) {
  const { t } = useTranslation()
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text allowFontScaling style={[styles.rowTitle, { color: palette.foreground }]}>{t('notifications.marketingOptOut.title')}</Text>
        <Text allowFontScaling style={[styles.rowDescription, { color: palette.mutedForeground }]}>{t('notifications.marketingOptOut.description')}</Text>
      </View>
      <Toggle
        checked={optedOut}
        disabled={disabled}
        label={optedOut ? t('notifications.marketingOptOut.toggleOffLabel') : t('notifications.marketingOptOut.toggleOnLabel')}
        onToggle={onToggle}
        palette={palette}
      />
    </View>
  )
}

function Toggle({ checked, disabled, label, onToggle, palette }: {
  checked: boolean
  disabled: boolean
  label: string
  onToggle: (next: boolean) => void
  palette: Palette
}) {
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled, busy: disabled }}
      disabled={disabled}
      hitSlop={8}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={() => onToggle(!checked)}
      style={({ pressed }) => [
        styles.track,
        { backgroundColor: checked ? palette.primary : palette.muted, borderColor: palette.border },
        focused && { borderWidth: 2, borderColor: palette.foreground },
        (pressed || disabled) && styles.pressed,
      ]}
    >
      <View style={[styles.thumb, { backgroundColor: palette.background, alignSelf: checked ? 'flex-end' : 'flex-start' }]} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  list: { borderWidth: 1, borderRadius: themeTokens.radius.lg, overflow: 'hidden' },
  row: {
    minHeight: themeTokens.touchTarget.minimum,
    flexDirection: 'row',
    alignItems: 'center',
    gap: themeTokens.spacing[4],
    padding: themeTokens.spacing[4],
  },
  rowText: { flex: 1, gap: themeTokens.spacing[1] },
  rowTitle: {
    fontFamily: themeTokens.typography.roles.interface.fontFamily,
    fontSize: themeTokens.typography.roles.interface.fontSize,
    lineHeight: themeTokens.typography.roles.interface.lineHeight,
    fontWeight: '500',
  },
  rowDescription: { ...textStyles.meta },
  rowDetail: { ...textStyles.label },
  statusLine: { gap: themeTokens.spacing[1], marginTop: themeTokens.spacing[1] },
  status: { ...textStyles.label, fontWeight: '600' as const },
  pauseReason: { ...textStyles.label },
  track: {
    width: 52,
    height: 32,
    borderRadius: themeTokens.radius.pill,
    borderWidth: 1,
    padding: 3,
    justifyContent: 'center',
  },
  thumb: { width: 24, height: 24, borderRadius: themeTokens.radius.pill },
  pressed: { opacity: 0.72 },
  saving: { ...textStyles.body },
  banner: { borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4] },
  bannerText: { ...textStyles.body },
})
