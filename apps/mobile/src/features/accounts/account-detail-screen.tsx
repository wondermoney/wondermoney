import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { formatCurrency } from '@/lib/formatters/financial'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'
import { BackControl } from '@/components/ui/back-control'
import { ObjectHeader } from '@/components/ui/page-header'
import type { MetricRow } from '@/features/account-insights/insights-view-model'

import { RecentTransactionsSection, type RecentTransactionsSectionState } from '@/features/transactions/recent-transactions-section'

import { formatAccountFreshness, type AccountDetailViewModel } from './account-detail-view-model'

export type AccountDetailData = AccountDetailViewModel & { metrics?: readonly MetricRow[]; metricsFromDate?: string }
export type AccountDetailViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'not-found' }
  | { status: 'invalid-id' }
  | { status: 'invalid-response' }
  | { status: 'access-transition' }
  | { status: 'loaded'; data: AccountDetailData }
  | { status: 'refresh-error'; data: AccountDetailData }

export type AccountDetailScreenProps = {
  state: AccountDetailViewState
  recentTransactions: RecentTransactionsSectionState
  onBack: () => void
  onRetry: () => void | Promise<void>
  onRetryRecent: () => void | Promise<void>
  onLogout: () => void | Promise<void>
  onViewTransactions: () => void
  onCreateTransaction?: () => void
  onEdit: () => void
}


export function AccountDetailScreen({ state, recentTransactions, onBack, onRetry, onRetryRecent, onLogout, onViewTransactions, onCreateTransaction, onEdit }: AccountDetailScreenProps) {
  const { t, i18n } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'

  if (state.status === 'access-transition') return null

  if (state.status === 'loading') {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
        <View style={styles.loadingHeader}>
          <BackControl fallback="/accounts" onPress={onBack} color={palette.primary} />
        </View>
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={t('accountDetail.loading')}
          style={styles.loading}
        >
          {[220, 320, 240].map((width, index) => (
            <View
              key={index}
              style={[styles.skeleton, { width, backgroundColor: palette.muted }]}
            />
          ))}
        </View>
      </SafeAreaView>
    )
  }

  if (
    state.status === 'error'
    || state.status === 'not-found'
    || state.status === 'invalid-id'
    || state.status === 'invalid-response'
  ) {
    const messageKey = state.status === 'not-found'
      ? 'notFound'
      : state.status === 'invalid-id'
        ? 'invalidId'
        : state.status === 'invalid-response'
          ? 'invalidResponse'
          : 'error'
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
        <ScrollView contentContainerStyle={styles.centered}>
          <View style={styles.failure}>
            <BackControl fallback="/accounts" onPress={onBack} color={palette.primary} />
            <View style={[styles.errorMarker, { backgroundColor: palette.destructive }]} />
            <Text
              accessibilityRole="header"
              allowFontScaling
              style={[styles.failureTitle, { color: palette.foreground }]}
            >
              {t(`accountDetail.${messageKey}.title`)}
            </Text>
            <Text allowFontScaling style={[styles.body, { color: palette.mutedForeground }]}>
              {t(`accountDetail.${messageKey}.message`)}
            </Text>
            <View style={styles.actions}>
              {state.status === 'error' || state.status === 'invalid-response' ? (
                <Action label={t('common.retry')} onPress={onRetry} palette={palette} primary />
              ) : null}
              <Action label={t('common.signOut')} onPress={onLogout} palette={palette} />
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    )
  }

  const data = state.data
  const name = data.accountName ?? t('accounts.unnamed')
  const source = data.source === 'manual'
    ? t('accounts.source.manual')
    : t('accounts.source.openBanking')
  const original = data.originalBalance === null
    ? t('accounts.balanceUnavailable')
    : formatCurrency(data.originalBalance, { locale, currency: data.originalCurrencyCode })
  const differs = data.originalCurrencyCode !== data.primaryCurrencyCode
  const converted = differs && data.convertedBalance !== null
    ? formatCurrency(data.convertedBalance, { locale, currency: data.primaryCurrencyCode })
    : null
  const refreshed = formatAccountFreshness(data.refreshedAt, locale)

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.page}>
            <BackControl fallback="/accounts" onPress={onBack} color={palette.primary} />

          {state.status === 'refresh-error' ? (
            <View style={[styles.banner, { backgroundColor: palette.muted, borderColor: palette.border }]}><Text
              accessible
              accessibilityRole="alert"
              accessibilityLabel={t('accountDetail.stale')}
              allowFontScaling
              style={[
                styles.banner,
                {
                  color: palette.foreground,
                  backgroundColor: palette.muted,
                  borderColor: palette.border,
                },
              ]}
            >
              {t('accountDetail.stale')}
            </Text><Action label={t('common.retry')} onPress={onRetry} palette={palette} /></View>
          ) : null}

          <ObjectHeader
            action={<Action label={t('accountDetail.edit')} onPress={onEdit} palette={palette} />}
            descriptor={[data.institutionDisplayName, source].filter(Boolean).join(' · ')}
            figure={
              <Text
                accessibilityLabel={`${t('accountDetail.originalBalance')}, ${original}${data.originalBalance === null ? '' : `, ${data.originalCurrencyCode}`}`}
                accessible
                allowFontScaling
                style={[styles.balance, { color: data.originalBalance === null ? palette.mutedForeground : palette.foreground }]}
              >
                {original}
              </Text>
            }
            title={name}
          />

          {differs ? (
            <View style={[styles.values, { borderTopColor: palette.border }]}>
              <ValueRow
                label={t('accounts.convertedBalance')}
                value={converted ?? t('accountDetail.convertedUnavailable')}
                currency={converted ? data.primaryCurrencyCode : null}
                palette={palette}
                unavailable={converted === null}
              />
            </View>
          ) : null}

          <Action label={t('accountDetail.viewTransactions')} onPress={onViewTransactions} palette={palette} primary />
          {onCreateTransaction ? <Action label={t('transactionCreate.action')} onPress={onCreateTransaction} palette={palette} /> : null}

          {data.source === 'open_banking' ? (
            <Text allowFontScaling style={[styles.freshness, { color: palette.mutedForeground }]}>
              {refreshed
                ? t('accountDetail.lastUpdated', { date: refreshed })
                : t('accountDetail.updateUnavailable')}
            </Text>
          ) : null}

          <RecentTransactionsSection state={recentTransactions} onRetry={onRetryRecent} />

          {data.metrics && data.metricsFromDate ? <View style={[styles.values, { borderTopColor: palette.border }]}>
            <Text style={[styles.metricsTitle, { color: palette.foreground }]}>{t('insights.accountMetrics')}</Text>
            <Text style={[styles.metricsNote, { color: palette.mutedForeground }]}>{t('insights.accountMetricsRange', { date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(data.metricsFromDate)) })}</Text>
            {data.metrics.length ? data.metrics.map((metric) => <View key={metric.accountId} style={styles.metricPair}>
              <ValueRow label={t('insights.inflow')} value={metric.inflow === null ? t('insights.unavailable') : metric.currency ? formatCurrency(metric.inflow, { locale, currency: metric.currency }) : t('insights.currencyUnavailable')} currency={metric.inflow === null ? null : metric.currency} palette={palette} unavailable={metric.inflow === null || metric.currency === null} />
              <ValueRow label={t('insights.outflow')} value={metric.outflow === null ? t('insights.unavailable') : metric.currency ? formatCurrency(metric.outflow, { locale, currency: metric.currency }) : t('insights.currencyUnavailable')} currency={metric.outflow === null ? null : metric.currency} palette={palette} unavailable={metric.outflow === null || metric.currency === null} separated />
            </View>) : <Text style={[styles.metricsNote, { color: palette.mutedForeground }]}>{t('insights.noMetrics')}</Text>}
          </View> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function ValueRow({
  label,
  value,
  currency,
  palette,
  unavailable,
  separated = false,
}: {
  label: string
  value: string
  currency: string | null
  palette: Palette
  unavailable: boolean
  separated?: boolean
}) {
  return (
    <View
      accessible
      accessibilityLabel={[label, value, currency].filter(Boolean).join(', ')}
      style={[
        styles.valueRow,
        separated && { borderTopWidth: 1, borderTopColor: palette.border },
      ]}
    >
      <Text allowFontScaling style={[styles.valueLabel, { color: palette.mutedForeground }]}>
        {label}
      </Text>
      <Text
        allowFontScaling
        style={[styles.value, { color: unavailable ? palette.mutedForeground : palette.foreground }]}
      >
        {value}
      </Text>
    </View>
  )
}

function Action({
  label,
  onPress,
  palette,
  primary = false,
}: {
  label: string
  onPress: () => void | Promise<void>
  palette: Palette
  primary?: boolean
}) {
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      accessibilityRole="button"
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={() => void onPress()}
      style={({ pressed }) => [
        styles.action,
        {
          borderColor: primary ? 'transparent' : palette.input,
          backgroundColor: primary ? palette.primary : 'transparent',
        },
        focused && { borderWidth: 2, borderColor: palette.foreground },
        pressed && styles.pressed,
      ]}
    >
      <Text
        allowFontScaling
        style={[
          styles.actionLabel,
          { color: primary ? palette.primaryForeground : palette.foreground },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding },
  page: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    alignItems: 'flex-start',
    gap: themeTokens.layout.blockGap,
  },
  heading: { gap: themeTokens.spacing[2] },
  headingRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[3] },
  title: { ...textStyles.title },
  balance: { ...textStyles.display },
  institution: { ...textStyles.body },
  values: {
    width: '100%',
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    paddingTop: themeTokens.spacing[3],
    gap: themeTokens.spacing[2],
  },
  valueRow: {
    flex: 1,
    minHeight: themeTokens.layout.rowMinHeight,
    paddingVertical: themeTokens.spacing[2],
    gap: 2,
  },
  // Inflow and outflow are one comparison, not two readings.
  metricPair: { flexDirection: 'row', gap: themeTokens.spacing[6] },
  valueLabel: { ...textStyles.meta },
  value: { ...textStyles.amount },
  freshness: { ...textStyles.body },
  banner: { ...textStyles.body, width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4] },
  action: {
    minWidth: themeTokens.touchTarget.minimum,
    minHeight: themeTokens.touchTarget.minimum,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: themeTokens.radius.md,
    paddingHorizontal: themeTokens.spacing[4],
  },
  actionLabel: {
    fontFamily: themeTokens.typography.roles.interface.fontFamily,
    fontSize: themeTokens.typography.roles.interface.fontSize,
    lineHeight: themeTokens.typography.roles.interface.lineHeight,
    fontWeight: '600',
  },
  pressed: { opacity: 0.72 },
  loadingHeader: { padding: themeTokens.layout.screenPadding, alignItems: 'flex-start' },
  loading: {
    flex: 1,
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    padding: themeTokens.layout.screenPadding,
    gap: themeTokens.spacing[5],
  },
  skeleton: {
    maxWidth: '100%',
    height: themeTokens.spacing[6],
    borderRadius: themeTokens.radius.sm,
  },
  centered: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: themeTokens.layout.screenPadding,
  },
  failure: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    alignItems: 'flex-start',
    gap: themeTokens.spacing[4],
  },
  errorMarker: { width: 36, height: 2 },
  failureTitle: { ...textStyles.title },
  body: {
    fontFamily: themeTokens.typography.roles.interface.fontFamily,
    fontSize: themeTokens.typography.roles.interface.fontSize,
    lineHeight: 24,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: themeTokens.spacing[3],
  },
  metricsTitle: { ...textStyles.section, paddingHorizontal: themeTokens.spacing[4], paddingTop: themeTokens.spacing[4] },
  metricsNote: { ...textStyles.meta, paddingHorizontal: themeTokens.spacing[4], paddingBottom: themeTokens.spacing[3] },
  metricDetail: { width: '100%' },
})
