import { useTranslation } from 'react-i18next'
import { RefreshControl, StyleSheet, View } from 'react-native'

import { Badge, type BadgeTone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { SettingsLoading, SettingsPage, SettingsSection } from '@/features/more/settings-ui'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import type { BankSyncHistoryRow } from './sync-history-view-model'

export type SyncHistoryScreenState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'not-found' }
  | { status: 'loaded'; rows: readonly BankSyncHistoryRow[] }

export type SyncHistoryScreenProps = {
  state: SyncHistoryScreenState
  institutionName?: null | string
  refreshing?: boolean
  onBack: () => void
  onRetry: () => void | Promise<void>
  onRefresh?: () => void | Promise<void>
}

const RESULT_TONE: Record<NonNullable<BankSyncHistoryRow['result']>, BadgeTone> = {
  failed: 'destructive',
  full_success: 'success',
  partial: 'warning',
}

/**
 * Settings › Connections › Sync history: the last 20 runs of one connection,
 * newest first. Same information and order as web's `SyncHistoryDrawer`.
 */
export function SyncHistoryScreen({ state, institutionName, refreshing, onBack, onRetry, onRefresh }: SyncHistoryScreenProps) {
  const { t } = useTranslation()
  const palette = usePalette()

  return (
    <SettingsPage
      backLabel={t('self.back')}
      onBack={onBack}
      refreshControl={onRefresh ? (
        <RefreshControl refreshing={Boolean(refreshing)} onRefresh={() => void onRefresh()} tintColor={palette.primary} />
      ) : undefined}
      section="connections"
    >
      <SettingsSection
        first
        description={t('bank-sync.history.description')}
        title={institutionName?.trim() || t('bank-sync.history.title')}
      >
        {state.status === 'loading' ? <SettingsLoading label={t('bank-sync.history.loading')} /> : null}

        {state.status === 'error' || state.status === 'not-found' ? (
          <View style={[styles.notice, { borderColor: palette.border }]}>
            <Text accessibilityRole="alert" variant="metaStrong">
              {t(state.status === 'not-found' ? 'banking.connections.error.title' : 'bank-sync.history.error')}
            </Text>
            <Button label={t('common.retry')} onPress={() => void onRetry()} size="sm" variant="outline" />
          </View>
        ) : null}

        {state.status === 'loaded' ? (
          state.rows.length === 0 ? (
            <Text tone="muted" variant="meta">{t('bank-sync.history.empty')}</Text>
          ) : (
            <View style={[styles.list, { borderColor: palette.border }]}>
              {state.rows.map((row, index) => (
                <SyncRun key={`${row.startedAt}-${row.finishedAt ?? 'running'}`} row={row} separated={index > 0} />
              ))}
            </View>
          )
        ) : null}
      </SettingsSection>
    </SettingsPage>
  )
}

function SyncRun({ row, separated }: { row: BankSyncHistoryRow; separated: boolean }) {
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })
  const result = row.result ? t(`bank-sync.history.result.${row.result}`) : t('bank-sync.history.inProgress')
  const flow = row.flow ? t(`bank-sync.history.flow.${row.flow}`) : null

  return (
    <View style={[styles.run, separated && { borderTopWidth: 1, borderTopColor: palette.border }]}>
      <View style={styles.runHead}>
        <Text variant="metaStrong">{dateFormatter.format(new Date(row.startedAt))}</Text>
        <Badge label={result} tone={row.result ? RESULT_TONE[row.result] : 'secondary'} />
      </View>

      <View style={styles.meta}>
        {flow ? <Text tone="muted" variant="label">{flow}</Text> : null}
        {row.finishedAt ? (
          <Text tone="muted" variant="label">
            {t('bank-sync.history.finished')} {dateFormatter.format(new Date(row.finishedAt))}
          </Text>
        ) : null}
        {row.accounts !== null ? (
          <Text tone="muted" variant="label">{t('bank-sync.history.accounts', { count: row.accounts })}</Text>
        ) : null}
        {row.rowsCreated !== null ? (
          <Text tone="muted" variant="label">{t('bank-sync.history.rows', { count: row.rowsCreated })}</Text>
        ) : null}
      </View>

      {row.error ? (
        <View style={styles.error}>
          <Text variant="meta">{t(row.error.messageKey)}</Text>
          <Text tone="muted" variant="label">{t(row.error.actionKey)}</Text>
          {row.retryAt ? (
            <Text tone="muted" variant="label">
              {t('bank-sync.history.nextAttempt', { date: dateFormatter.format(new Date(row.retryAt)) })}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  notice: { borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4], gap: themeTokens.spacing[2], alignItems: 'flex-start' },
  list: { borderTopWidth: 1, borderBottomWidth: 1 },
  run: { paddingVertical: themeTokens.spacing[3], gap: themeTokens.spacing[2] },
  runHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[2] },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
  error: { gap: themeTokens.spacing[1] },
})
