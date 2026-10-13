import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import type { BankConnectionDisconnectFailure } from './use-bank-connection-disconnect-mutation'
import type { BankConnectionRow } from './connection-status-view-model'


export type ConnectionsScreenState =
  | { status: 'access-transition' }
  | { status: 'loading' }
  | { status: 'invalid-id' }
  | { status: 'invalid-response' }
  | { status: 'error' }
  | { status: 'loaded'; rows: readonly BankConnectionRow[] }

export type ConnectionDisconnectFailureState = Readonly<{ connectionId: number; failure: BankConnectionDisconnectFailure }>

export type ConnectionsScreenProps = {
  state: ConnectionsScreenState
  justStarted?: boolean
  refreshing?: boolean
  onBack: () => void
  onRetry: () => void | Promise<void>
  onRefresh?: () => void | Promise<void>
  onConnectBank?: () => void
  onDisconnect?: (connectionId: number) => Promise<void>
  disconnectingConnectionId?: null | number
  disconnectFailure?: ConnectionDisconnectFailureState | null
  onImportStatement?: () => void
}

export function ConnectionsScreen({ state, justStarted, refreshing, onBack, onRetry, onRefresh, onConnectBank, onDisconnect, disconnectingConnectionId, disconnectFailure, onImportStatement }: ConnectionsScreenProps) {
  const { t } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const [focusedAction, setFocusedAction] = useState<null | 'retry' | 'back' | 'connect'>(null)

  if (state.status === 'access-transition') return null

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={onRefresh ? (
          <RefreshControl refreshing={Boolean(refreshing)} onRefresh={() => void onRefresh()} tintColor={palette.primary} />
        ) : undefined}
      >
        <View style={styles.page}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('self.back')}
            onFocus={() => setFocusedAction('back')}
            onBlur={() => setFocusedAction(null)}
            onPress={() => void onBack()}
            style={({ pressed }) => [
              styles.back,
              focusedAction === 'back' && { borderWidth: 2, borderColor: palette.foreground },
              pressed && styles.pressed,
            ]}
          >
            <Text allowFontScaling style={[styles.backLabel, { color: palette.foreground }]}>
              {t('self.back')}
            </Text>
          </Pressable>

          <View style={styles.heading}>
            <Text accessibilityRole="header" allowFontScaling style={[styles.title, { color: palette.foreground }]}>
              {t('banking.connections.heading')}
            </Text>
            <Text allowFontScaling style={[styles.helper, { color: palette.mutedForeground }]}>
              {t('banking.connections.helper')}
            </Text>
          </View>
          <Text allowFontScaling style={[styles.trust, { color: palette.mutedForeground }]}>
            {t('banking.connections.readOnlyTrust')}
          </Text>

          {onConnectBank ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('banking.connections.connectCta')}
              onFocus={() => setFocusedAction('connect')}
              onBlur={() => setFocusedAction(null)}
              onPress={onConnectBank}
              style={({ pressed }) => [
                styles.connectCta,
                { borderColor: palette.primary, backgroundColor: palette.primary },
                focusedAction === 'connect' && { borderWidth: 2, borderColor: palette.foreground },
                pressed && styles.pressed,
              ]}
            >
              <Text allowFontScaling style={[styles.connectCtaLabel, { color: palette.background }]}>
                {t('banking.connections.connectCta')}
              </Text>
            </Pressable>
          ) : null}

          {justStarted ? (
            <View style={[styles.notice, { borderColor: palette.border, backgroundColor: palette.muted }]}>
              <Text allowFontScaling style={[styles.noticeTitle, { color: palette.foreground }]}>
                {t('banking.connections.justStarted.title')}
              </Text>
              <Text allowFontScaling style={[styles.noticeBody, { color: palette.mutedForeground }]}>
                {t('banking.connections.justStarted.message')}
              </Text>
            </View>
          ) : null}

          {state.status === 'loading' || state.status === 'invalid-id' ? (
            <View
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel={t('banking.connections.loading')}
              style={styles.loading}
            >
              <View style={[styles.skeleton, { width: 260, height: 20, backgroundColor: palette.muted }]} />
              <View style={[styles.skeleton, { width: 320, height: 20, backgroundColor: palette.muted }]} />
            </View>
          ) : null}

          {state.status === 'error' || state.status === 'invalid-response' ? (
            <View style={[styles.notice, { borderColor: palette.border, backgroundColor: palette.muted }]}>
              <Text accessibilityRole="alert" allowFontScaling style={[styles.noticeTitle, { color: palette.foreground }]}>
                {t(state.status === 'invalid-response' ? 'banking.connections.invalidResponse.title' : 'banking.connections.error.title')}
              </Text>
              <Text allowFontScaling style={[styles.noticeBody, { color: palette.mutedForeground }]}>
                {t(state.status === 'invalid-response' ? 'banking.connections.invalidResponse.message' : 'banking.connections.error.message')}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('common.retry')}
                onFocus={() => setFocusedAction('retry')}
                onBlur={() => setFocusedAction(null)}
                onPress={() => void onRetry()}
                style={({ pressed }) => [
                  styles.retry,
                  { borderColor: palette.primary, backgroundColor: palette.primary },
                  focusedAction === 'retry' && { borderWidth: 2, borderColor: palette.foreground },
                  pressed && styles.pressed,
                ]}
              >
                <Text allowFontScaling style={[styles.retryLabel, { color: palette.background }]}>
                  {t('common.retry')}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {state.status === 'loaded' ? (
            state.rows.length === 0 ? (
              <View style={[styles.empty, { borderColor: palette.border, backgroundColor: palette.card }]}>
                <View style={[styles.emptyMarker, { backgroundColor: palette.mutedForeground }]} />
                <Text accessibilityRole="header" allowFontScaling style={[styles.noticeTitle, { color: palette.foreground }]}>
                  {t('banking.connections.emptyTitle')}
                </Text>
                <Text allowFontScaling style={[styles.noticeBody, { color: palette.mutedForeground }]}>
                  {t('banking.connections.emptyMessage')}
                </Text>
              </View>
            ) : (
              <View style={styles.list}>
                {state.rows.map((row, index) => (
                  <ConnectionRow
                    key={row.connectionId ?? `${row.provider}-${row.expiresAt ?? index}`}
                    row={row}
                    palette={palette}
                    separated={index > 0}
                    onDisconnect={onDisconnect}
                    disconnecting={row.connectionId !== null && row.connectionId === disconnectingConnectionId}
                    failure={row.connectionId !== null && disconnectFailure?.connectionId === row.connectionId ? disconnectFailure.failure : null}
                    onImportStatement={onImportStatement}
                  />
                ))}
              </View>
            )
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function ConnectionRow({ row, palette, separated, onDisconnect, disconnecting, failure, onImportStatement }: {
  row: BankConnectionRow
  palette: Palette
  separated: boolean
  onDisconnect?: (connectionId: number) => Promise<void>
  disconnecting: boolean
  failure: BankConnectionDisconnectFailure | null
  onImportStatement?: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const institution = row.institutionName ?? t('banking.connections.unnamedInstitution')
  const statusLabel = t(`banking.connections.status.${row.status}`)
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })
  const expiry = row.expiresAt ? dateFormatter.format(new Date(row.expiresAt)) : t('banking.connections.unavailableDate')
  const freshness = row.dataFreshAsOf
    ? t('banking.connections.freshnessOn', { date: dateFormatter.format(new Date(row.dataFreshAsOf)) })
    : t('banking.connections.freshnessUnknown')
  const canDisconnect = onDisconnect !== undefined && row.connectionId !== null
  const connectionId = row.connectionId

  const requestDisconnect = () => {
    if (!canDisconnect || disconnecting || connectionId === null) return
    Alert.alert(
      t('banking.connections.disconnect.confirmTitle', { institution }),
      t('banking.connections.disconnect.confirmMessage', { institution }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('banking.connections.disconnect.confirmAction'),
          style: 'destructive',
          onPress: () => void onDisconnect(connectionId),
        },
      ],
      { cancelable: true },
    )
  }

  return (
    <View
      style={[
        styles.row,
        { borderColor: palette.border },
        separated && { borderTopWidth: 1, borderTopColor: palette.border },
      ]}
    >
      <View
        accessible
        accessibilityRole="text"
        accessibilityLabel={t('banking.connections.rowLabel', { institution, status: statusLabel, expiry, freshness })}
        style={styles.rowSummary}
      >
        <Text allowFontScaling style={[styles.institution, { color: palette.foreground }]}>
          {institution}
        </Text>
        <Text allowFontScaling style={[styles.status, { color: palette.mutedForeground }]}>
          {statusLabel}
        </Text>
        <Text allowFontScaling style={[styles.meta, { color: palette.mutedForeground }]}>
          {t('banking.connections.expiresOn', { date: expiry })}
        </Text>
        <Text allowFontScaling style={[styles.meta, { color: palette.mutedForeground }]}>
          {freshness}
        </Text>
      </View>

      {failure ? (
        <Text accessibilityRole="alert" allowFontScaling style={[styles.rowFailure, { color: palette.destructive }]}>
          {t(`banking.connections.disconnect.failures.${failure}`)}
        </Text>
      ) : null}

      {row.status === 'error' && onImportStatement ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('banking.connections.importStatement.actionLabel', { institution })}
          onPress={onImportStatement}
          style={({ pressed }) => [styles.importStatement, { borderColor: palette.border }, pressed && styles.pressed]}
        >
          <Text allowFontScaling style={[styles.importStatementLabel, { color: palette.primary }]}>
            {t('banking.connections.importStatement.action')}
          </Text>
        </Pressable>
      ) : null}

      {canDisconnect ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('banking.connections.disconnect.actionLabel', { institution })}
          accessibilityState={{ disabled: disconnecting, busy: disconnecting }}
          disabled={disconnecting}
          onPress={requestDisconnect}
          style={({ pressed }) => [
            styles.disconnect,
            { borderColor: palette.destructive },
            (pressed || disconnecting) && styles.pressed,
          ]}
        >
          <Text allowFontScaling style={[styles.disconnectLabel, { color: palette.destructive }]}>
            {disconnecting ? t('banking.connections.disconnect.disconnecting') : t('banking.connections.disconnect.action')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding },
  page: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    gap: themeTokens.layout.blockGap,
  },
  back: {
    minHeight: themeTokens.touchTarget.minimum,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: themeTokens.spacing[3],
  },
  backLabel: { ...textStyles.bodyStrong },
  heading: { gap: themeTokens.spacing[2] },
  title: { ...textStyles.title },
  helper: { ...textStyles.body },
  loading: { gap: themeTokens.spacing[3] },
  skeleton: { borderRadius: themeTokens.radius.sm },
  notice: {
    borderWidth: 1,
    borderRadius: themeTokens.radius.lg,
    padding: themeTokens.spacing[4],
    gap: themeTokens.spacing[3],
  },
  noticeTitle: { ...textStyles.action },
  noticeBody: { ...textStyles.body },
  connectCta: {
    minHeight: themeTokens.touchTarget.minimum,
    alignSelf: 'flex-start',
    paddingHorizontal: themeTokens.spacing[4],
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: themeTokens.radius.md,
  },
  connectCtaLabel: { ...textStyles.action },
  retry: {
    minHeight: themeTokens.touchTarget.minimum,
    alignSelf: 'flex-start',
    paddingHorizontal: themeTokens.spacing[4],
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: themeTokens.radius.md,
  },
  retryLabel: { ...textStyles.action },
  empty: {
    borderWidth: 1,
    borderRadius: themeTokens.radius.md,
    padding: themeTokens.spacing[4],
    gap: themeTokens.spacing[3],
  },
  emptyMarker: { width: 40, height: 3, borderRadius: themeTokens.radius.pill },
  trust: { ...textStyles.meta },
  list: {
    width: '100%',
    gap: 0,
  },
  row: {
    width: '100%',
    padding: themeTokens.spacing[4],
    gap: themeTokens.spacing[3],
  },
  rowSummary: { gap: themeTokens.spacing[1] },
  institution: { ...textStyles.section },
  status: { ...textStyles.bodyStrong },
  meta: { ...textStyles.meta },
  rowFailure: { ...textStyles.meta },
  disconnect: {
    minHeight: themeTokens.touchTarget.minimum,
    alignSelf: 'flex-start',
    paddingHorizontal: themeTokens.spacing[4],
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: themeTokens.radius.md,
  },
  disconnectLabel: { ...textStyles.bodyStrong, fontWeight: '600' as const },
  importStatement: {
    minHeight: themeTokens.touchTarget.minimum,
    alignSelf: 'flex-start',
    paddingHorizontal: themeTokens.spacing[4],
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: themeTokens.radius.md,
  },
  importStatementLabel: { ...textStyles.bodyStrong, fontWeight: '600' as const },
  pressed: { opacity: 0.72 },
})
