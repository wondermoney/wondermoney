import { useTranslation } from 'react-i18next'
import { StyleSheet, Text, View } from 'react-native'

import { formatCurrency, formatPercentagePoints } from '@/lib/formatters/financial'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import type { PortfolioAnalyticsViewModel } from './portfolio-activity-view-model'
import { type Palette, ScreenAction } from './portfolio-screen-parts'

export type PortfolioAnalyticsState =
  | { status: 'idle' | 'loading' | 'rate-limited' | 'error' | 'invalid-response' }
  | { status: 'loaded' | 'refresh-error' | 'rate-limited-cached'; data: PortfolioAnalyticsViewModel; refreshing?: boolean }

export function PortfolioAnalyticsPanel({ state, locale, palette, onEnable, onRetry }: {
  state: PortfolioAnalyticsState
  locale: string
  palette: Palette
  onEnable: () => void
  onRetry: () => void | Promise<unknown>
}) {
  const { t } = useTranslation()
  if (state.status === 'idle') return <View style={[styles.shell, { borderColor: palette.border }]}><Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>{t('portfolioAnalytics.title')}</Text><Text style={[styles.body, { color: palette.mutedForeground }]}>{t('portfolioAnalytics.helper')}</Text><ScreenAction label={t('portfolioAnalytics.load')} onPress={onEnable} palette={palette} primary /></View>
  if (state.status === 'loading') return <View accessible accessibilityRole="progressbar" accessibilityLabel={t('portfolioAnalytics.loading')} style={[styles.shell, { borderColor: palette.border }]}><Text style={[styles.body, { color: palette.mutedForeground }]}>{t('portfolioAnalytics.loading')}</Text></View>
  if (state.status === 'rate-limited' || state.status === 'error' || state.status === 'invalid-response') {
    const rateLimited = state.status === 'rate-limited'
    return <View style={[styles.shell, { borderColor: palette.border }]}><Text accessibilityRole="alert" style={[styles.body, { color: palette.foreground }]}>{t(rateLimited ? 'portfolioAnalytics.rateLimit' : state.status === 'invalid-response' ? 'portfolioAnalytics.invalid' : 'portfolioAnalytics.error')}</Text><ScreenAction label={rateLimited ? t('portfolioAnalytics.tryLater') : t('common.retry')} onPress={onRetry} palette={palette} primary /></View>
  }
  if (!('data' in state)) return null
  const data = state.data
  const money = (value: number) => data.currency ? `${formatCurrency(value, { locale, currency: data.currency })}` : t('portfolioAnalytics.valueCurrencyUnavailable', { value: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value) })
  const unavailable = t('portfolioAnalytics.unavailable')
  const riskReady = data.risk.readiness === 'ready'
  return <View style={styles.panel}>
    <View style={styles.sectionHeading}><Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>{t('portfolioAnalytics.title')}</Text><ScreenAction label={t('common.refresh')} onPress={onRetry} palette={palette} disabled={state.refreshing} /></View>
    {state.status === 'rate-limited-cached' ? <Text accessibilityRole="alert" style={[styles.banner, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.muted }]}>{t('portfolioAnalytics.rateLimitCached')}</Text> : null}
    {state.status === 'refresh-error' ? <Text accessibilityRole="alert" style={[styles.banner, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.muted }]}>{t('portfolioAnalytics.stale')}</Text> : null}
    <View style={[styles.shell, { borderColor: palette.border }]}>
      <Text accessibilityRole="header" style={[styles.subtitle, { color: palette.foreground }]}>{t('portfolioAnalytics.allocation')}</Text>
      <View accessible accessibilityLabel={t('portfolioAnalytics.allocation')} style={styles.table}>{data.allocation.length === 0 ? <Text style={[styles.body, { color: palette.mutedForeground }]}>{t('portfolioAnalytics.noAllocation')}</Text> : data.allocation.map((item) => <View key={item.type} accessible accessibilityLabel={`${item.type}, ${formatPercentagePoints(item.percentage, locale, { maximumFractionDigits: 1 })}, ${money(item.value)}`} style={[styles.tableRow, { borderBottomColor: palette.border }]}><Text style={[styles.cell, { color: palette.foreground }]}>{item.type}</Text><Text style={[styles.data, { color: palette.foreground }]}>{formatPercentagePoints(item.percentage, locale, { maximumFractionDigits: 1 })}</Text><Text style={[styles.data, { color: palette.foreground }]}>{money(item.value)}</Text></View>)}</View>
    </View>
    <View style={[styles.shell, { borderColor: palette.border }]}>
      <Text accessibilityRole="header" style={[styles.subtitle, { color: palette.foreground }]}>{t('portfolioAnalytics.dividends')}</Text>
      <Text accessible accessibilityLabel={`${t('portfolioAnalytics.totalDividends')}, ${money(data.totalDividends)}`} style={[styles.total, { color: palette.foreground }]}>{money(data.totalDividends)}</Text>
      <Text style={[styles.body, { color: palette.mutedForeground }]}>{data.currency ? t('portfolioAnalytics.dividendCurrency', { currency: data.currency }) : t('portfolioAnalytics.dividendCurrencyUnavailable')}</Text>
      {data.dividends.map((item) => <View key={`${item.symbol}-${item.value}`} style={styles.inline}><Text style={[styles.ticker, { color: palette.foreground }]}>{item.symbol}</Text><Text style={[styles.data, { color: palette.foreground }]}>{money(item.value)}</Text></View>)}
    </View>
    <View style={[styles.shell, { borderColor: palette.border }]}>
      <Text accessibilityRole="header" style={[styles.subtitle, { color: palette.foreground }]}>{t('portfolioAnalytics.risk')}</Text>
      <Text style={[styles.body, { color: palette.mutedForeground }]}>{t(riskReady ? 'portfolioAnalytics.riskReady' : 'portfolioAnalytics.riskNotReady')}</Text>
      <SummaryRow label={t('portfolioAnalytics.riskLevel')} value={riskReady ? data.risk.level ?? unavailable : unavailable} palette={palette} />
      <SummaryRow label={t('portfolioAnalytics.volatility')} value={riskReady && data.risk.volatility !== null ? formatPercentagePoints(data.risk.volatility, locale) : unavailable} palette={palette} />
      <SummaryRow label={t('portfolioAnalytics.maxDrawdown')} value={riskReady && data.risk.maxDrawdown !== null ? formatPercentagePoints(data.risk.maxDrawdown, locale) : unavailable} palette={palette} />
      <SummaryRow label={t('portfolioAnalytics.sharpeRatio')} value={riskReady && data.risk.sharpeRatio !== null ? new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(data.risk.sharpeRatio) : unavailable} palette={palette} />
    </View>
  </View>
}

function SummaryRow({ label, value, palette }: { label: string; value: string; palette: Palette }) {
  return <View accessible accessibilityLabel={`${label}, ${value}`} style={styles.inline}><Text style={[styles.cell, { color: palette.mutedForeground }]}>{label}</Text><Text style={[styles.data, { color: palette.foreground }]}>{value}</Text></View>
}

const styles = StyleSheet.create({
  panel: { width: '100%', gap: themeTokens.spacing[4] }, shell: { width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[5], gap: themeTokens.spacing[3] }, sectionHeading: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: themeTokens.spacing[3] }, title: { ...textStyles.section }, subtitle: { ...textStyles.section }, body: { ...textStyles.body }, table: { width: '100%' }, tableRow: { minHeight: 52, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: themeTokens.spacing[3], borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: themeTokens.spacing[2] }, cell: { ...textStyles.body, flex: 1, minWidth: 100 }, data: { ...textStyles.amount }, total: { ...textStyles.display }, ticker: { ...textStyles.amount, flex: 1 }, inline: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[3] }, banner: { ...textStyles.body, width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4] },
})
