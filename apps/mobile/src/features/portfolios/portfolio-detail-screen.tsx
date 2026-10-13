import { useTranslation } from 'react-i18next'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button } from '@/components/ui/button'
import { BackControl } from '@/components/ui/back-control'
import { ObjectHeader } from '@/components/ui/page-header'
import { PreviewLabel } from '@/components/ui/preview-label'
import { formatCurrency, formatPercentagePoints } from '@/lib/formatters/financial'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import type { PortfolioDividendIncomeViewModel } from './portfolio-activity-view-model'
import { PortfolioPerformanceChart, type PortfolioPerformanceChartProps } from './portfolio-performance-chart'
import { Metric, PortfolioFailure, PortfolioLoading } from './portfolio-screen-parts'
import type { HoldingViewModel, PortfolioDetailViewModel } from './portfolios-view-model'

export type PortfolioDividendIncomeSectionState =
  | { status: 'idle' | 'loading' | 'error' }
  | { status: 'loaded'; data: PortfolioDividendIncomeViewModel }

export type PortfolioDetailViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'not-found' }
  | { status: 'invalid-id' }
  | { status: 'invalid-response' }
  | { status: 'access-transition' }
  | { status: 'loaded'; data: PortfolioDetailViewModel; refreshing?: boolean }
  | { status: 'refresh-error'; data: PortfolioDetailViewModel; refreshing?: boolean }

export type PortfolioDetailScreenProps = {
  state: PortfolioDetailViewState
  performance: Omit<PortfolioPerformanceChartProps, 'palette'>
  dividendIncome?: PortfolioDividendIncomeSectionState
  onBack: () => void
  onOpenActivity: () => void
  onOpenSettings?: () => void
  onOpenImport?: () => void
  onOpenAddTransaction?: () => void
  onOpenHolding?: (assetId: number) => void
  onRefresh: () => void | Promise<void>
  onLogout: () => void | Promise<void>
}

const tone = (value: number) => value > 0 ? 'positive' as const : value < 0 ? 'negative' as const : 'muted' as const

export function PortfolioDetailScreen({ state, performance, dividendIncome = { status: 'idle' }, onBack, onOpenActivity, onOpenSettings = () => undefined, onOpenImport = () => undefined, onOpenAddTransaction = () => undefined, onOpenHolding = () => undefined, onRefresh, onLogout }: PortfolioDetailScreenProps) {
  const { t, i18n } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  if (state.status === 'access-transition') return null
  if (state.status === 'loading') return <PortfolioLoading label={t('portfolioDetail.loading')} palette={palette} onBack={onBack} backLabel={t('portfolioDetail.back')} />
  if (state.status === 'error' || state.status === 'not-found' || state.status === 'invalid-id' || state.status === 'invalid-response') {
    const key = state.status === 'not-found' ? 'notFound' : state.status === 'invalid-id' ? 'invalidId' : state.status === 'invalid-response' ? 'invalidResponse' : 'error'
    return <PortfolioFailure title={t(`portfolioDetail.${key}.title`)} message={t(`portfolioDetail.${key}.message`)} retryLabel={t('common.retry')} signOutLabel={t('common.signOut')} backLabel={t('portfolioDetail.back')} onRetry={onRefresh} onSignOut={onLogout} onBack={onBack} canRetry={state.status === 'error' || state.status === 'invalid-response'} palette={palette} />
  }

  const { data } = state
  const money = (value: number, currency: string) => `${formatCurrency(value, { locale, currency })}`
  const percent = (value: number) => formatPercentagePoints(value, locale, { maximumFractionDigits: 1 })
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={Boolean(state.refreshing)} onRefresh={() => void onRefresh()} tintColor={palette.primary} />}>
        <View style={styles.page}>
          <BackControl fallback="/portfolio" onPress={onBack} color={palette.primary} />
          {state.status === 'refresh-error' ? <View style={[styles.banner, { borderColor: palette.border, backgroundColor: palette.muted }]}><Text accessibilityRole="alert" allowFontScaling style={[styles.bannerText, { color: palette.foreground }]}>{t('portfolioDetail.stale')}</Text><Button label={t('common.retry')} onPress={onRefresh} palette={palette} variant="secondary" /></View> : null}
          <View style={styles.heading}>
            <ObjectHeader descriptor={data.description ?? undefined} title={data.name} />
            <Text allowFontScaling style={[styles.meta, { color: palette.mutedForeground }]}>{t('portfolioDetail.portfolioCurrency', { currency: data.nativeCurrency })}</Text>
          </View>
          <View style={styles.detailActions}><Button label={t('portfolioDetail.addTransaction')} onPress={onOpenAddTransaction} palette={palette} variant="primary" /><Button label={t('portfolioDetail.settings')} onPress={onOpenSettings} palette={palette} variant="secondary" /><Button label={t('portfolioDetail.activity')} onPress={onOpenActivity} palette={palette} variant="secondary" /><Button label={t('portfolioDetail.import')} onPress={onOpenImport} palette={palette} variant="secondary" /></View>

          <View style={[styles.summary, { borderColor: palette.border, backgroundColor: palette.muted }]}>
            <Text allowFontScaling style={[styles.label, { color: palette.mutedForeground }]}>{t('portfolioDetail.totalValue')}</Text>
            <Text allowFontScaling style={[styles.total, { color: palette.foreground }]}>{money(data.totalValue, data.currency)}</Text>
            <View style={styles.metrics}>
              <Metric label={t('portfolioDetail.gainLoss')} value={`${money(data.totalGainLoss, data.currency)} · ${percent(data.totalGainLossPercent)}`} palette={palette} tone={tone(data.totalGainLoss)} />
              <Metric label={t('portfolioDetail.ytdReturn')} value={data.periodReturn === null ? t('portfolioDetail.ytdPending') : percent(data.periodReturn)} palette={palette} tone={data.periodReturn === null ? 'muted' : tone(data.periodReturn)} />
            </View>
          </View>

          <PortfolioPerformanceChart {...performance} palette={palette} />

          <View style={styles.section}>
            <Text accessibilityRole="header" allowFontScaling style={[styles.sectionTitle, { color: palette.foreground }]}>{t('portfolioDetail.quickStats')}</Text>
            <View style={[styles.quickStats, { borderColor: palette.border }]}>
              <Metric label={t('portfolioDetail.holdingsCount')} value={String(data.holdingsCount)} palette={palette} />
              <Metric label={t('portfolioDetail.assetCount')} value={String(data.assetCount)} palette={palette} />
              <Metric label={t('portfolioDetail.biggestPosition')} value={data.biggestPosition ? `${data.biggestPosition.ticker} · ${percent(data.biggestPosition.weight)}` : t('portfolioDetail.unavailable')} palette={palette} tone={data.biggestPosition ? 'default' : 'muted'} />
              <Metric label={t('portfolioDetail.bestPerformer')} value={data.bestPerformer ? `${data.bestPerformer.ticker} · ${percent(data.bestPerformer.change)}` : t('portfolioDetail.unavailable')} palette={palette} tone={data.bestPerformer ? tone(data.bestPerformer.change) : 'muted'} />
            </View>
          </View>

          {dividendIncome.status !== 'idle' ? (
            <View style={styles.section}>
              <Text accessibilityRole="header" allowFontScaling style={[styles.sectionTitle, { color: palette.foreground }]}>{t('portfolioDetail.dividendIncome.title')}</Text>
              <DividendIncomeSection state={dividendIncome} locale={locale} palette={palette} />
            </View>
          ) : null}

          <View style={styles.section}>
            <Text accessibilityRole="header" allowFontScaling style={[styles.sectionTitle, { color: palette.foreground }]}>{t('portfolioDetail.holdings')}</Text>
            {data.holdings.length === 0 ? <View style={[styles.emptyCard, { borderColor: palette.border, backgroundColor: palette.card }]}><View style={styles.emptyCopy}><Text allowFontScaling style={[styles.emptyTitle, { color: palette.foreground }]}>{t('portfolioDetail.emptyHoldingsTitle')}</Text><Text allowFontScaling style={[styles.empty, { color: palette.mutedForeground }]}>{t('portfolioDetail.emptyHoldings')}</Text></View><View style={styles.emptyPreview}><PreviewLabel /><View style={styles.previewLine}><Text allowFontScaling style={[styles.ticker, { color: palette.foreground }]}>AAPL</Text><Text allowFontScaling style={[styles.quantity, { color: palette.mutedForeground }]}>10 · 35%</Text></View><View style={styles.previewLine}><Text allowFontScaling style={[styles.ticker, { color: palette.foreground }]}>VWCE</Text><Text allowFontScaling style={[styles.quantity, { color: palette.mutedForeground }]}>15 · 22%</Text></View></View><View style={styles.emptyActions}><Button label={t('portfolioDetail.addTransaction')} onPress={onOpenAddTransaction} palette={palette} variant="primary" /><Button label={t('portfolioDetail.import')} onPress={onOpenImport} palette={palette} variant="secondary" /></View></View> : <View style={styles.holdings}>{data.holdings.map((holding) => <HoldingRow key={holding.id} holding={holding} locale={locale} palette={palette} onPress={() => onOpenHolding(holding.id)} />)}</View>}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

/** RAD-515 — per-portfolio dividend income (total + by-asset breakdown), the same data web shows
 * both aggregate on /portfolio and scoped on the portfolio detail page. Independent of the rest of
 * the page's data: a slow/failed fetch here only affects this section. */
function DividendIncomeSection({ state, locale, palette }: {
  state: PortfolioDividendIncomeSectionState
  locale: string
  palette: (typeof themeTokens.colors)[keyof typeof themeTokens.colors]
}) {
  const { t } = useTranslation()
  if (state.status === 'loading') return <Text accessibilityRole="progressbar" accessibilityLabel={t('portfolioDetail.dividendIncome.loading')} allowFontScaling style={[styles.helper, { color: palette.mutedForeground }]}>{t('portfolioDetail.dividendIncome.loading')}</Text>
  if (state.status === 'error') return <Text accessibilityRole="alert" allowFontScaling style={[styles.helper, { color: palette.mutedForeground }]}>{t('portfolioDetail.dividendIncome.error')}</Text>
  // The parent only mounts this component once status !== 'idle', but the prop type still
  // includes it — narrow explicitly rather than widening the prop type for callers.
  if (state.status !== 'loaded') return null
  const { data } = state
  const money = (value: number) => data.currency ? `${formatCurrency(value, { locale, currency: data.currency })}` : t('portfolioAnalytics.valueCurrencyUnavailable', { value: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value) })
  if (data.dividends.length === 0) return <Text allowFontScaling style={[styles.empty, { color: palette.mutedForeground, borderColor: palette.border }]}>{t('portfolioDetail.dividendIncome.empty')}</Text>
  return (
    <View style={[styles.quickStats, { borderColor: palette.border }]}>
      <Metric label={t('portfolioDetail.dividendIncome.total')} value={money(data.totalDividends)} palette={palette} />
      {data.dividends.map((item) => <Metric key={item.symbol} label={item.symbol} value={money(item.value)} palette={palette} />)}
    </View>
  )
}

function HoldingRow({ holding, locale, palette, onPress }: { holding: HoldingViewModel; locale: string; palette: (typeof themeTokens.colors)[keyof typeof themeTokens.colors]; onPress: () => void }) {
  const { t } = useTranslation()
  const money = (value: number | null) => value === null ? t('portfolioDetail.unavailable') : `${formatCurrency(value, { locale, currency: holding.currency })}`
  const percent = (value: number | null) => value === null ? t('portfolioDetail.unavailable') : formatPercentagePoints(value, locale, { maximumFractionDigits: 1 })
  const currentValue = money(holding.currentValue)
  const gain = holding.gain === null ? t('portfolioDetail.unavailable') : `${money(holding.gain)} · ${percent(holding.gainPercent)}`
  const accessibilityLabel = [holding.symbol, holding.name, holding.type, holding.isInvalid ? t('portfolioDetail.needsAttention') : null, `${t('portfolioDetail.quantity')} ${holding.quantity}`, `${t('portfolioDetail.currentValue')} ${currentValue}`, `${t('portfolioDetail.gainLoss')} ${gain}`].filter(Boolean).join(', ')
  return (
    <Pressable testID={holding.isInvalid ? 'invalid-holding' : 'holding-row'} accessible accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => [styles.holding, { borderColor: holding.isInvalid ? palette.destructive : palette.border, backgroundColor: palette.card }, pressed && styles.pressed]}>
      <View style={styles.holdingHeader}>
        <View style={styles.identity}>
          <Text allowFontScaling style={[styles.ticker, { color: palette.foreground }]}>{holding.symbol}</Text>
          <Text allowFontScaling style={[styles.holdingName, { color: palette.mutedForeground }]}>{holding.name} · {holding.type}</Text>
        </View>
        {holding.isInvalid ? <View style={[styles.attention, { borderColor: palette.destructive }]}><View style={[styles.attentionMarker, { backgroundColor: palette.destructive }]} /><Text allowFontScaling style={[styles.attentionText, { color: palette.destructive }]}>{t('portfolioDetail.needsAttention')}</Text></View> : null}
      </View>
      {holding.isInvalid ? <Text allowFontScaling style={[styles.attentionNote, { color: palette.foreground }]}>{t('portfolioDetail.invalidHolding')}</Text> : null}
      <View style={styles.holdingMetrics}>
        <Metric label={t('portfolioDetail.currentValue')} value={currentValue} palette={palette} tone={holding.currentValue === null ? 'muted' : 'default'} />
        <Metric label={t('portfolioDetail.gainLoss')} value={gain} palette={palette} tone={holding.gain === null ? 'muted' : tone(holding.gain)} />
        <Metric label={t('portfolioDetail.currentPrice')} value={money(holding.currentPrice)} palette={palette} tone={holding.currentPrice === null ? 'muted' : 'default'} />
        <Metric label={t('portfolioDetail.averageBuyPrice')} value={money(holding.averageBuyPrice)} palette={palette} tone={holding.averageBuyPrice === null ? 'muted' : 'default'} />
      </View>
      <Text allowFontScaling style={[styles.quantity, { color: palette.mutedForeground }]}>{t('portfolioDetail.quantityValue', { value: new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(holding.quantity) })}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 }, content: { flexGrow: 1, padding: themeTokens.layout.screenPadding }, page: { width: '100%', maxWidth: 800, alignSelf: 'center', alignItems: 'flex-start', gap: themeTokens.layout.blockGap },
  banner: { width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] }, bannerText: { ...textStyles.body }, heading: { width: '100%', gap: themeTokens.spacing[2] }, helper: { ...textStyles.body }, meta: { ...textStyles.meta },
  summary: { width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.xl, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] }, label: { ...textStyles.meta }, total: { ...textStyles.display }, metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[5] },
  section: { width: '100%', gap: themeTokens.spacing[3] }, sectionTitle: { ...textStyles.section }, quickStats: { flexDirection: 'row', flexWrap: 'wrap', borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[5] },
  holdings: { gap: themeTokens.spacing[3] }, holding: { borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] }, holdingHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: themeTokens.spacing[3] }, identity: { flex: 1, minWidth: 160, gap: themeTokens.spacing[1] }, ticker: { ...textStyles.amount }, holdingName: { ...textStyles.meta }, holdingMetrics: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[5] }, quantity: { ...textStyles.amountSmall },
  attention: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2], borderWidth: 1, borderRadius: themeTokens.radius.sm, paddingHorizontal: themeTokens.spacing[2], paddingVertical: themeTokens.spacing[1] }, attentionMarker: { width: 8, height: 2 }, attentionText: { ...textStyles.meta, fontWeight: '600' as const }, attentionNote: { ...textStyles.body },
  empty: { ...textStyles.body }, emptyCard: { width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[5], gap: themeTokens.spacing[4] }, emptyCopy: { gap: themeTokens.spacing[2] }, emptyTitle: { ...textStyles.section }, emptyPreview: { borderWidth: 1, borderColor: 'transparent', borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[3], gap: themeTokens.spacing[2] }, previewLabel: { ...textStyles.label }, previewLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, emptyActions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[3] },
  detailActions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[3] },
  pressed: { opacity: 0.72 },
})
