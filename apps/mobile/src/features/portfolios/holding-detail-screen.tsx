import { useTranslation } from 'react-i18next'
import { RefreshControl, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BackControl } from '@/components/ui/back-control'
import { ObjectHeader } from '@/components/ui/page-header'
import { formatCurrency, formatPercentagePoints } from '@/lib/formatters/financial'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import { FeeConversionNotice } from './fee-conversion-notice'
import type { PortfolioActivityRow } from './portfolio-activity-view-model'
import { Metric, PortfolioFailure, PortfolioLoading } from './portfolio-screen-parts'
import type { HoldingViewModel } from './portfolios-view-model'

export type HoldingDetailViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'not-found' }
  | { status: 'access-transition' }
  | { status: 'loaded'; holding: HoldingViewModel; activity: readonly PortfolioActivityRow[]; refreshing: boolean }

export type HoldingDetailScreenProps = {
  state: HoldingDetailViewState
  onBack: () => void
  onRefresh: () => void | Promise<void>
  onLogout: () => void | Promise<void>
}

const tone = (value: number) => value > 0 ? 'positive' as const : value < 0 ? 'negative' as const : 'muted' as const

export function HoldingDetailScreen({ state, onBack, onRefresh, onLogout }: HoldingDetailScreenProps) {
  const { t, i18n } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  if (state.status === 'access-transition') return null
  if (state.status === 'loading') return <PortfolioLoading label={t('holdingDetail.loading')} palette={palette} onBack={onBack} backLabel={t('holdingDetail.back')} />
  if (state.status === 'error' || state.status === 'not-found') {
    const key = state.status === 'not-found' ? 'notFound' : 'error'
    return <PortfolioFailure title={t(`holdingDetail.${key}.title`)} message={t(`holdingDetail.${key}.message`)} retryLabel={t('common.retry')} signOutLabel={t('common.signOut')} backLabel={t('holdingDetail.back')} onRetry={onRefresh} onSignOut={onLogout} onBack={onBack} canRetry={state.status === 'error'} palette={palette} />
  }

  const { holding, activity } = state
  const money = (value: number | null) => value === null ? t('holdingDetail.unavailable') : `${formatCurrency(value, { locale, currency: holding.currency })}`
  const percent = (value: number | null) => value === null ? t('holdingDetail.unavailable') : formatPercentagePoints(value, locale, { maximumFractionDigits: 1 })

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={state.refreshing} onRefresh={() => void onRefresh()} tintColor={palette.primary} />}>
        <View style={styles.page}>
          <BackControl fallback="/portfolio" onPress={onBack} color={palette.primary} label={t('holdingDetail.back')} />
          <View style={styles.heading}>
            <ObjectHeader descriptor={`${holding.name} · ${holding.type}`} title={holding.symbol} />
          </View>

          {holding.isInvalid ? (
            <View style={[styles.notice, { borderColor: palette.destructive, backgroundColor: palette.muted }]}>
              <Text allowFontScaling style={[styles.noticeText, { color: palette.foreground }]}>{t('holdingDetail.invalidHolding')}</Text>
            </View>
          ) : null}

          <View style={[styles.summary, { borderColor: palette.border, backgroundColor: palette.muted }]}>
            <Text allowFontScaling style={[styles.label, { color: palette.mutedForeground }]}>{t('holdingDetail.currentValue')}</Text>
            <Text allowFontScaling style={[styles.total, { color: palette.foreground }]}>{money(holding.currentValue)}</Text>
            <View style={styles.metrics}>
              <Metric label={t('holdingDetail.gainLoss')} value={holding.gain === null ? t('holdingDetail.unavailable') : `${money(holding.gain)} · ${percent(holding.gainPercent)}`} palette={palette} tone={holding.gain === null ? 'muted' : tone(holding.gain)} />
              <Metric label={t('holdingDetail.portfolioWeight')} value={percent(holding.allocation)} palette={palette} tone={holding.allocation === null ? 'muted' : 'default'} />
              <Metric label={t('holdingDetail.quantity')} value={new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(holding.quantity)} palette={palette} />
              <Metric label={t('holdingDetail.currentPrice')} value={money(holding.currentPrice)} palette={palette} tone={holding.currentPrice === null ? 'muted' : 'default'} />
              <Metric label={t('holdingDetail.averageBuyPrice')} value={money(holding.averageBuyPrice)} palette={palette} tone={holding.averageBuyPrice === null ? 'muted' : 'default'} />
            </View>
            {holding.feeConversionIncomplete ? <FeeConversionNotice scope="holding" palette={palette} /> : null}
          </View>

          <View style={styles.section}>
            <Text accessibilityRole="header" allowFontScaling style={[styles.sectionTitle, { color: palette.foreground }]}>{t('holdingDetail.activity')}</Text>
            {activity.length === 0 ? (
              <Text allowFontScaling style={[styles.empty, { color: palette.mutedForeground, borderColor: palette.border }]}>{t('holdingDetail.emptyActivity')}</Text>
            ) : (
              <View style={styles.activityList}>
                {activity.map((row) => <ActivityRow key={row.id} row={row} locale={locale} currency={holding.currency} palette={palette} />)}
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function ActivityRow({ row, locale, currency, palette }: { row: PortfolioActivityRow; locale: string; currency: string; palette: (typeof themeTokens.colors)[keyof typeof themeTokens.colors] }) {
  const { t } = useTranslation()
  const date = row.timestamp ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(row.timestamp)) : t('holdingDetail.unavailable')
  const amount = row.amount === null ? null : `${formatCurrency(row.amount, { locale, currency: row.currency ?? currency })}`
  const label = row.itemType === 'STOCK_SPLIT'
    ? t('holdingDetail.stockSplit')
    : row.type
      ? t(`portfolioTransactionCreate.types.${row.type}`, { defaultValue: row.type })
      : t('holdingDetail.unavailable')
  return (
    <View accessible accessibilityLabel={`${label}, ${date}${amount ? `, ${amount}` : ''}`} style={[styles.activityRow, { borderColor: palette.border, backgroundColor: palette.card }]}>
      <View style={styles.activityHeader}>
        <Text allowFontScaling style={[styles.activityType, { color: palette.foreground }]}>{label}</Text>
        <Text allowFontScaling style={[styles.activityDate, { color: palette.mutedForeground }]}>{date}</Text>
      </View>
      {amount ? <Text allowFontScaling style={[styles.activityAmount, { color: palette.foreground }]}>{amount}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 }, content: { flexGrow: 1, padding: themeTokens.layout.screenPadding }, page: { width: '100%', maxWidth: 800, alignSelf: 'center', alignItems: 'flex-start', gap: themeTokens.layout.blockGap },
  heading: { width: '100%', gap: themeTokens.spacing[2] }, helper: { ...textStyles.body },
  notice: { width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4] }, noticeText: { ...textStyles.body },
  summary: { width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.xl, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] }, label: { ...textStyles.meta }, total: { ...textStyles.display }, metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[5] },
  section: { width: '100%', gap: themeTokens.spacing[3] }, sectionTitle: { ...textStyles.section },
  empty: { ...textStyles.body, width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.layout.screenPadding },
  activityList: { width: '100%', gap: themeTokens.spacing[3] },
  activityRow: { borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[2] },
  activityHeader: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: themeTokens.spacing[2] },
  activityType: { ...textStyles.action },
  activityDate: { ...textStyles.meta },
  activityAmount: { ...textStyles.amount },
})
