import { useTranslation } from 'react-i18next'
import { Alert, RefreshControl, StyleSheet, View } from 'react-native'
import { bankSyncErrorCopy } from '@wondermoney/shared/bank-sync'

import { Badge, type BadgeTone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { SettingsLoading, SettingsNotice, SettingsPage, SettingsSection } from '@/features/more/settings-ui'
import { themeTokens, type Palette } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import type { BankConnectionResult } from './bank-connection-return'
import { type BankConnectionTarget, isSameBankConnection } from './connection-status-contract'
import type { BankConnectionDisconnectFailure } from './use-bank-connection-disconnect-mutation'
import type { BankConnectionRow } from './connection-status-view-model'
import { startBankConnectionFailureMessageKey, type StartBankConnectionFailure } from './use-start-bank-connection'


export type ConnectionsScreenState =
  | { status: 'access-transition' }
  | { status: 'loading' }
  | { status: 'invalid-id' }
  | { status: 'invalid-response' }
  | { status: 'error' }
  | { status: 'loaded'; rows: readonly BankConnectionRow[] }

export type ConnectionDisconnectFailureState = Readonly<{ connectionId: number; provider: BankConnectionTarget['provider']; failure: BankConnectionDisconnectFailure }>

export type ConnectionReconnectFailureState = Readonly<{ bankId: string; failure: StartBankConnectionFailure }>

/** Rows whose consent has ended, or ends soon, offer "Reconnect". */
const RECONNECTABLE_STATUSES: ReadonlySet<BankConnectionRow['status']> = new Set(['expiring', 'expired', 'revoked'])

/** SimpleFIN has no consent to renew: an ended connection is connected again with a new setup token. */
function canReconnectRow(row: BankConnectionRow): boolean {
  return row.provider !== 'SimpleFIN' && row.bankId !== null && RECONNECTABLE_STATUSES.has(row.status)
}

/** Providers whose connections have a sync history the API exposes. */
const HISTORY_PROVIDERS: ReadonlySet<BankConnectionRow['provider']> = new Set(['EnableBanking', 'SimpleFIN'])

function targetOf(row: BankConnectionRow): BankConnectionTarget | null {
  return row.connectionId === null ? null : { connectionId: row.connectionId, provider: row.provider }
}

export type ConnectionsScreenProps = {
  state: ConnectionsScreenState
  justStarted?: boolean
  /** The outcome the bank connection's callback reported, when the app saw it. */
  connectionResult?: BankConnectionResult | null
  refreshing?: boolean
  onBack: () => void
  onRetry: () => void | Promise<void>
  onRefresh?: () => void | Promise<void>
  onConnectBank?: () => void
  /** Present only when the server offers SimpleFIN (`features.bankSyncProviders`). */
  onConnectSimplefin?: () => void
  onDisconnect?: (target: BankConnectionTarget) => Promise<void>
  disconnectingConnection?: BankConnectionTarget | null
  disconnectFailure?: ConnectionDisconnectFailureState | null
  onImportStatement?: () => void
  /** Opens the last 20 sync runs for a connection. */
  onViewHistory?: (target: BankConnectionTarget, institutionName: null | string) => void
  /** Starts a new connection to the row's bank; the API keeps the existing accounts. */
  onReconnect?: (bankId: string) => void
  reconnectingBankId?: null | string
  reconnectFailure?: ConnectionReconnectFailureState | null
}

/**
 * Settings › Connections (web `components/settings/Connections/Connections.tsx`): the
 * "Bank connections" head and description, then one row per connection (institution,
 * status badge, expiry, freshness, its actions), flat on the canvas with hairlines.
 * Mobile keeps its read-only note, the connect button and the callback notices.
 */
export function ConnectionsScreen({ state, justStarted, connectionResult, refreshing, onBack, onRetry, onRefresh, onConnectBank, onConnectSimplefin, onDisconnect, disconnectingConnection, disconnectFailure, onImportStatement, onReconnect, onViewHistory, reconnectingBankId, reconnectFailure }: ConnectionsScreenProps) {
  const { t } = useTranslation()
  const palette = usePalette()

  if (state.status === 'access-transition') return null

  return (
    <SettingsPage
      backLabel={t('self.back')}
      onBack={onBack}
      refreshControl={onRefresh ? (
        <RefreshControl refreshing={Boolean(refreshing)} onRefresh={() => void onRefresh()} tintColor={palette.primary} />
      ) : undefined}
      section="connections"
    >
      <SettingsSection first title={t('settings.connections.heading')} description={t('settings.connections.description')}>
        <Text tone="muted" variant="label">{t('banking.connections.readOnlyTrust')}</Text>

        {onConnectBank ? (
          <Button block icon="plus" label={t('banking.connections.connectCta')} onPress={onConnectBank} />
        ) : null}

        {onConnectSimplefin ? (
          <View style={styles.simplefin}>
            <Button block icon="link" label={t('banking.connections.simplefinCta')} onPress={onConnectSimplefin} variant="outline" />
            <Text tone="muted" variant="label">{t('banking.connections.simplefinHint')}</Text>
          </View>
        ) : null}

        {connectionResult ? (
          <View style={[styles.notice, { borderColor: connectionResult === 'error' ? palette.destructiveText : palette.border }]}>
            <Text
              accessibilityLiveRegion="polite"
              accessibilityRole={connectionResult === 'error' ? 'alert' : 'text'}
              variant="metaStrong"
            >
              {t(`banking.connections.result.${connectionResult}.title`)}
            </Text>
            <Text tone="muted" variant="meta">{t(`banking.connections.result.${connectionResult}.message`)}</Text>
          </View>
        ) : justStarted ? (
          <SettingsNotice
            message={t('banking.connections.justStarted.message')}
            title={t('banking.connections.justStarted.title')}
          />
        ) : null}

        {state.status === 'loading' || state.status === 'invalid-id' ? (
          <SettingsLoading label={t('banking.connections.loading')} />
        ) : null}

        {state.status === 'error' || state.status === 'invalid-response' ? (
          <View style={[styles.notice, { borderColor: palette.border }]}>
            <Text accessibilityRole="alert" variant="metaStrong">
              {t(state.status === 'invalid-response' ? 'banking.connections.invalidResponse.title' : 'banking.connections.error.title')}
            </Text>
            <Text tone="muted" variant="meta">
              {t(state.status === 'invalid-response' ? 'banking.connections.invalidResponse.message' : 'banking.connections.error.message')}
            </Text>
            <Button label={t('common.retry')} onPress={() => void onRetry()} size="sm" variant="outline" />
          </View>
        ) : null}

        {state.status === 'loaded' ? (
          state.rows.length === 0 ? (
            <View style={styles.empty}>
              <Text accessibilityRole="header" variant="metaStrong">{t('banking.connections.emptyTitle')}</Text>
              <Text tone="muted" variant="meta">{t('banking.connections.emptyMessage')}</Text>
            </View>
          ) : (
            <View style={[styles.list, { borderColor: palette.border }]}>
              {state.rows.map((row, index) => (
                <ConnectionRow
                  key={row.connectionId !== null ? `${row.provider}-${row.connectionId}` : `${row.provider}-${row.expiresAt ?? index}`}
                  row={row}
                  palette={palette}
                  separated={index > 0}
                  onDisconnect={onDisconnect}
                  disconnecting={isSameBankConnection(targetOf(row), disconnectingConnection)}
                  failure={disconnectFailure && isSameBankConnection(targetOf(row), disconnectFailure) ? disconnectFailure.failure : null}
                  onImportStatement={onImportStatement}
                  onReconnect={onReconnect}
                  onViewHistory={onViewHistory}
                  reconnecting={row.bankId !== null && row.bankId === reconnectingBankId}
                  reconnectBlocked={Boolean(reconnectingBankId)}
                  reconnectFailure={row.bankId !== null && reconnectFailure?.bankId === row.bankId ? reconnectFailure.failure : null}
                />
              ))}
            </View>
          )
        ) : null}
      </SettingsSection>
    </SettingsPage>
  )
}

const STATUS_TONE: Record<BankConnectionRow['status'], BadgeTone> = {
  processing: 'secondary',
  connected: 'primary',
  error: 'destructive',
  expired: 'warning',
  expiring: 'warning',
  revoked: 'warning',
  unknown: 'outline',
}

function ConnectionRow({ row, palette, separated, onDisconnect, disconnecting, failure, onImportStatement, onReconnect, onViewHistory, reconnecting, reconnectBlocked, reconnectFailure }: {
  row: BankConnectionRow
  palette: Palette
  separated: boolean
  onDisconnect?: (target: BankConnectionTarget) => Promise<void>
  disconnecting: boolean
  failure: BankConnectionDisconnectFailure | null
  onImportStatement?: () => void
  onReconnect?: (bankId: string) => void
  onViewHistory?: (target: BankConnectionTarget, institutionName: null | string) => void
  reconnecting: boolean
  reconnectBlocked: boolean
  reconnectFailure: StartBankConnectionFailure | null
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const providerName = PROVIDER_NAMES[row.provider]
  const institution = row.institutionName?.trim()
    || (providerName ? t('banking.connections.providerConnection', { provider: providerName }) : t('banking.connections.unnamedInstitution'))
  // SimpleFIN access has no consent end date, so its rows leave the expiry out, and an ended
  // one says it was revoked rather than "ended by bank".
  const isSimplefin = row.provider === 'SimpleFIN'
  const statusLabel = isSimplefin && row.status === 'revoked'
    ? t('banking.connections.simplefin.statusRevoked')
    : t(`banking.connections.status.${row.status}`)
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })
  const expiry = row.expiresAt ? dateFormatter.format(new Date(row.expiresAt)) : t('banking.connections.unavailableDate')
  const showsExpiry = !isSimplefin
  const freshness = row.dataFreshAsOf
    ? t('banking.connections.freshnessOn', { date: dateFormatter.format(new Date(row.dataFreshAsOf)) })
    : t('banking.connections.freshnessUnknown')
  const target = targetOf(row)
  const canDisconnect = onDisconnect !== undefined && target !== null
  const bankId = row.bankId
  const canReconnect = onReconnect !== undefined && canReconnectRow(row)
  const canViewHistory = onViewHistory !== undefined && target !== null && HISTORY_PROVIDERS.has(row.provider)
  const consentNotice = isSimplefin
    ? (row.status === 'revoked' || row.status === 'expired' ? t('banking.connections.simplefin.accessEnded') : null)
    : row.status === 'expiring'
      ? t('banking.connections.consent.expiring', { count: row.daysUntilExpiry ?? 0 })
      : row.status === 'revoked'
        ? t('banking.connections.consent.revoked')
        : row.status === 'expired'
          ? t('banking.connections.consent.expired')
          : null

  const requestDisconnect = () => {
    if (!canDisconnect || disconnecting || target === null) return
    Alert.alert(
      t('banking.connections.disconnect.confirmTitle', { institution }),
      t('banking.connections.disconnect.confirmMessage', { institution }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('banking.connections.disconnect.confirmAction'),
          style: 'destructive',
          onPress: () => void onDisconnect(target),
        },
      ],
      { cancelable: true },
    )
  }

  return (
    <View style={[styles.row, separated && { borderTopWidth: 1, borderTopColor: palette.border }]}>
      <View
        accessible
        accessibilityLabel={showsExpiry
          ? t('banking.connections.rowLabel', { institution, status: statusLabel, expiry, freshness })
          : t('banking.connections.rowLabelNoExpiry', { institution, status: statusLabel, freshness })}
        accessibilityRole="text"
        style={styles.rowSummary}
      >
        <View style={styles.rowTitle}>
          <Text style={styles.institution} variant="metaStrong">{institution}</Text>
          <Badge label={statusLabel} tone={STATUS_TONE[row.status] ?? 'outline'} />
        </View>
        {showsExpiry ? <Text tone="muted" variant="label">{t('banking.connections.expiresOn', { date: expiry })}</Text> : null}
        <Text tone="muted" variant="label">{freshness}</Text>
      </View>

      {/* Outside the summary, whose accessibility label would hide it from screen readers. */}
      {consentNotice ? <Text variant="label">{consentNotice}</Text> : null}

      {row.lastError ? (
        <Text tone="muted" variant="label">{t(bankSyncErrorCopy(row.lastError.code).messageKey)}</Text>
      ) : null}

      {reconnectFailure ? (
        <Text accessibilityRole="alert" tone="destructive" variant="meta">
          {t(startBankConnectionFailureMessageKey(reconnectFailure))}
        </Text>
      ) : null}

      {failure ? (
        <Text accessibilityRole="alert" tone="destructive" variant="meta">
          {t(`banking.connections.disconnect.failures.${failure}`)}
        </Text>
      ) : null}

      {(row.status === 'error' && onImportStatement) || canDisconnect || canReconnect || canViewHistory ? (
        <View style={styles.actions}>
          {canViewHistory && target !== null ? (
            <Button
              accessibilityLabel={t('bank-sync.history.actionLabel', { institution })}
              label={t('bank-sync.history.action')}
              onPress={() => onViewHistory(target, row.institutionName)}
              size="sm"
              variant="ghost"
            />
          ) : null}
          {canReconnect && bankId !== null ? (
            <Button
              accessibilityLabel={t('banking.connections.reconnect.actionLabel', { institution })}
              disabled={reconnectBlocked}
              icon="refresh-cw"
              label={reconnecting ? t('banking.connections.reconnect.starting') : t('banking.connections.reconnect.action')}
              loading={reconnecting}
              onPress={() => onReconnect(bankId)}
              size="sm"
              variant={row.status === 'expiring' ? 'outline' : 'primary'}
            />
          ) : null}
          {row.status === 'error' && onImportStatement ? (
            <Button
              accessibilityLabel={t('banking.connections.importStatement.actionLabel', { institution })}
              label={t('banking.connections.importStatement.action')}
              onPress={onImportStatement}
              size="sm"
              variant="outline"
            />
          ) : null}
          {canDisconnect ? (
            <Button
              accessibilityLabel={t('banking.connections.disconnect.actionLabel', { institution })}
              disabled={disconnecting}
              label={disconnecting ? t('banking.connections.disconnect.disconnecting') : t('banking.connections.disconnect.action')}
              loading={disconnecting}
              onPress={requestDisconnect}
              size="sm"
              variant="ghost"
            />
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

/**
 * The API names a connection only when its accounts agree on one institution.
 * Without that name, the provider is still a better title than a generic
 * "Bank connection" repeated on every row.
 */
const PROVIDER_NAMES: Partial<Record<BankConnectionRow['provider'], string>> = {
  GoCardless: 'GoCardless',
  EnableBanking: 'Enable Banking',
  SimpleFIN: 'SimpleFIN',
}


const styles = StyleSheet.create({
  notice: { borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4], gap: themeTokens.spacing[2], alignItems: 'flex-start' },
  empty: { gap: themeTokens.spacing[1] },
  simplefin: { gap: themeTokens.spacing[1] },
  list: { borderTopWidth: 1, borderBottomWidth: 1 },
  row: { paddingVertical: themeTokens.spacing[3], gap: themeTokens.spacing[2] },
  rowSummary: { gap: 2 },
  rowTitle: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: themeTokens.spacing[2] },
  institution: { flexShrink: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
})
