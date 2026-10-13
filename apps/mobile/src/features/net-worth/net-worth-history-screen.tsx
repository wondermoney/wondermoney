import { useTranslation } from 'react-i18next'
import { ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BackControl } from '@/components/ui/back-control'
import { SelfFailure, SelfLoading, SelfStaleBanner, selfStyles, type Palette } from '@/features/self/self-screen-parts'
import { formatCurrency } from '@/lib/formatters/financial'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import type { NetWorthTrendPoint, NetWorthTrendViewModel } from './net-worth-history-view-model'

export type NetWorthHistoryViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'invalid-response' }
  | { status: 'access-transition' }
  | { status: 'loaded'; data: NetWorthTrendViewModel; refreshFailed: boolean; refreshing: boolean }

export type NetWorthHistoryScreenProps = {
  state: NetWorthHistoryViewState
  onBack: () => void
  onRetry: () => void | Promise<void>
  onLogout: () => void | Promise<void>
}

export function NetWorthHistoryScreen({ state, onBack, onRetry, onLogout }: NetWorthHistoryScreenProps) {
  const { t, i18n } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'

  if (state.status === 'access-transition') return null
  if (state.status === 'loading') {
    return <SelfLoading label={t('netWorthHistory.loading')} backLabel={t('netWorthHistory.back')} onBack={onBack} palette={palette} />
  }
  if (state.status === 'error' || state.status === 'invalid-response') {
    const invalid = state.status === 'invalid-response'
    return (
      <SelfFailure
        title={t(invalid ? 'netWorthHistory.invalidTitle' : 'netWorthHistory.errorTitle')}
        message={t(invalid ? 'netWorthHistory.invalidMessage' : 'netWorthHistory.errorMessage')}
        backLabel={t('netWorthHistory.back')}
        retryLabel={t('common.retry')}
        signOutLabel={t('common.signOut')}
        onBack={onBack}
        onRetry={onRetry}
        onLogout={onLogout}
        palette={palette}
      />
    )
  }

  const { data } = state
  const money = (value: number | null) =>
    value === null ? t('netWorthHistory.unavailable') : formatCurrency(value, { locale, currency: data.currencyCode })
  const monthLabel = (date: string) => {
    const parsed = new Date(`${date}T00:00:00.000Z`)
    return Number.isNaN(parsed.getTime())
      ? date
      : new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', timeZone: 'UTC' }).format(parsed)
  }

  return (
    <SafeAreaView style={[selfStyles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={selfStyles.content}>
        <View style={selfStyles.page}>
          <BackControl fallback="/" label={t('netWorthHistory.back')} onPress={onBack} />
          {state.refreshFailed ? (
            <SelfStaleBanner message={t('netWorthHistory.stale')} retryLabel={t('common.retry')} refreshing={state.refreshing} onRetry={onRetry} palette={palette} />
          ) : null}

          <View style={selfStyles.heading}>
            <Text accessibilityRole="header" allowFontScaling style={[selfStyles.title, { color: palette.foreground }]}>{t('netWorthHistory.title')}</Text>
            <Text allowFontScaling style={[selfStyles.helper, { color: palette.mutedForeground }]}>{t('netWorthHistory.helper')}</Text>
          </View>

          {data.readiness === 'empty' ? (
            <View style={[styles.notice, { borderColor: palette.border, backgroundColor: palette.muted }]}>
              <Text accessibilityRole="header" allowFontScaling style={[styles.noticeTitle, { color: palette.foreground }]}>{t('netWorthHistory.empty.title')}</Text>
              <Text allowFontScaling style={[styles.noticeText, { color: palette.mutedForeground }]}>{t('netWorthHistory.empty.message')}</Text>
            </View>
          ) : (
            <>
              {data.readiness === 'insufficient_history' ? (
                <Text accessibilityRole="alert" allowFontScaling style={[styles.insufficient, { color: palette.mutedForeground }]}>
                  {t('netWorthHistory.insufficient')}
                </Text>
              ) : null}

              <View style={[styles.statsCard, { borderColor: palette.border }]}>
                <StatRow label={t('netWorthHistory.stats.earliest')} value={money(data.stats.earliest)} palette={palette} />
                <StatRow label={t('netWorthHistory.stats.latest')} value={money(data.stats.latest)} palette={palette} separated />
                <StatRow label={t('netWorthHistory.stats.high')} value={money(data.stats.high)} palette={palette} separated />
                <StatRow label={t('netWorthHistory.stats.low')} value={money(data.stats.low)} palette={palette} separated />
                <StatRow
                  label={t('netWorthHistory.stats.netChange')}
                  value={data.stats.netChange === null ? t('netWorthHistory.unavailable') : signedMoney(data.stats.netChange, locale, data.currencyCode, t)}
                  palette={palette}
                  separated
                />
              </View>

              <View accessibilityRole="header" style={styles.tableHeader}>
                <Text allowFontScaling style={[styles.tableHeaderText, { color: palette.mutedForeground }]}>{t('netWorthHistory.table.month')}</Text>
                <Text allowFontScaling style={[styles.tableHeaderText, { color: palette.mutedForeground }]}>{t('netWorthHistory.table.value')}</Text>
              </View>
              <View style={[styles.list, { borderColor: palette.border }]}>
                {data.points.map((point, index) => (
                  <TrendRow key={point.date} point={point} label={monthLabel(point.date)} money={money} locale={locale} currency={data.currencyCode} separated={index > 0} palette={palette} />
                ))}
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function signedMoney(value: number, locale: string, currency: string, t: (key: string, opts?: Record<string, unknown>) => string) {
  const magnitude = formatCurrency(Math.abs(value), { locale, currency })
  if (value > 0) return t('netWorthHistory.change.increase', { amount: magnitude })
  if (value < 0) return t('netWorthHistory.change.decrease', { amount: magnitude })
  return t('netWorthHistory.change.none')
}

function TrendRow({ point, label, money, locale, currency, separated, palette }: {
  point: NetWorthTrendPoint
  label: string
  money: (value: number | null) => string
  locale: string
  currency: string
  separated: boolean
  palette: Palette
}) {
  const { t } = useTranslation()
  const valueText = money(point.value)
  const changeText = point.change === null ? null : signedMoney(point.change, locale, currency, t)
  const parts = [label, valueText]
  if (changeText) parts.push(changeText)
  if (!point.isComplete) parts.push(t('netWorthHistory.incomplete'))
  return (
    <View
      accessible
      accessibilityLabel={parts.join(', ')}
      style={[styles.row, separated && { borderTopWidth: 1, borderTopColor: palette.border }]}
    >
      <View style={styles.rowMonth}>
        <Text allowFontScaling style={[styles.month, { color: palette.foreground }]}>{label}</Text>
        {!point.isComplete ? (
          <Text allowFontScaling style={[styles.incomplete, { color: palette.mutedForeground }]}>{t('netWorthHistory.incomplete')}</Text>
        ) : null}
      </View>
      <View style={styles.rowValue}>
        <Text allowFontScaling style={[styles.value, { color: palette.foreground }]}>{valueText}</Text>
        {changeText ? <Text allowFontScaling style={[styles.change, { color: palette.mutedForeground }]}>{changeText}</Text> : null}
      </View>
    </View>
  )
}

function StatRow({ label, value, palette, separated = false }: { label: string; value: string; palette: Palette; separated?: boolean }) {
  return (
    <View accessible accessibilityLabel={`${label}, ${value}`} style={[styles.statRow, separated && { borderTopWidth: 1, borderTopColor: palette.border }]}>
      <Text allowFontScaling style={[styles.statLabel, { color: palette.mutedForeground }]}>{label}</Text>
      <Text allowFontScaling style={[styles.statValue, { color: palette.foreground }]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  notice: { borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[2] },
  noticeTitle: { ...textStyles.section },
  noticeText: { ...textStyles.body },
  insufficient: { ...textStyles.body },
  statsCard: { borderWidth: 1, borderRadius: themeTokens.radius.lg, overflow: 'hidden' },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: themeTokens.spacing[4], padding: themeTokens.spacing[4], minHeight: 52 },
  statLabel: { ...textStyles.body },
  statValue: { ...textStyles.amount },
  tableHeader: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: themeTokens.spacing[4] },
  tableHeaderText: { ...textStyles.label, fontWeight: '600' as const },
  list: { borderWidth: 1, borderRadius: themeTokens.radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: themeTokens.spacing[4], padding: themeTokens.spacing[4], minHeight: themeTokens.touchTarget.minimum },
  rowMonth: { flex: 1, gap: themeTokens.spacing[1] },
  month: { ...textStyles.bodyStrong },
  incomplete: { ...textStyles.label },
  rowValue: { alignItems: 'flex-end', gap: themeTokens.spacing[1] },
  value: { ...textStyles.amount },
  change: { ...textStyles.label },
})
