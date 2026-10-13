import { useTranslation } from 'react-i18next'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { PreviewLabel } from '@/components/ui/preview-label'
import { formatCurrency, formatPercentagePoints } from '@/lib/formatters/financial'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import { Metric, PortfolioFailure, PortfolioLoading } from './portfolio-screen-parts'
import { PortfolioAnalyticsPanel, type PortfolioAnalyticsState } from './portfolio-analytics-panel'
import type { PortfolioOverviewViewModel } from './portfolios-view-model'

export type PortfoliosViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'invalid-response' }
  | { status: 'access-transition' }
  | { status: 'loaded'; data: PortfolioOverviewViewModel; refreshing?: boolean }
  | { status: 'refresh-error'; data: PortfolioOverviewViewModel; refreshing?: boolean }

export type PortfoliosScreenProps = {
  state: PortfoliosViewState
  analyticsState: PortfolioAnalyticsState
  onEnableAnalytics: () => void
  onRetryAnalytics: () => void | Promise<unknown>
  onOpenActivity: () => void
  onCreatePortfolio?: () => void
  onRefresh: () => void | Promise<void>
  onLogout: () => void | Promise<void>
  onSelectPortfolio: (id: number) => void
}

const tone = (value: number) => value > 0 ? 'positive' as const : value < 0 ? 'negative' as const : 'muted' as const

const previewHoldings = [
  { symbol: 'AAPL', allocation: 35 },
  { symbol: 'MSFT', allocation: 28 },
  { symbol: 'VWCE', allocation: 22 },
  { symbol: 'GOOGL', allocation: 15 },
] as const

export function PortfoliosScreen({ state, analyticsState, onEnableAnalytics, onRetryAnalytics, onOpenActivity, onCreatePortfolio = () => undefined, onRefresh, onLogout, onSelectPortfolio }: PortfoliosScreenProps) {
  const { t, i18n } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  if (state.status === 'access-transition') return null
  if (state.status === 'loading') return <PortfolioLoading label={t('portfolios.loading')} palette={palette} />
  if (state.status === 'error' || state.status === 'invalid-response') {
    const invalid = state.status === 'invalid-response'
    return <PortfolioFailure title={t(invalid ? 'portfolios.invalidTitle' : 'portfolios.errorTitle')} message={t(invalid ? 'portfolios.invalidMessage' : 'portfolios.errorMessage')} retryLabel={t('common.retry')} signOutLabel={t('common.signOut')} onRetry={onRefresh} onSignOut={onLogout} palette={palette} />
  }

  const { data } = state
  const money = (value: number, currency: string) => `${formatCurrency(value, { locale, currency })}`
  const percent = (value: number) => formatPercentagePoints(value, locale, { maximumFractionDigits: 1 })
  const periodReturn = data.periodReturn === null ? t('portfolios.ytdPending') : percent(data.periodReturn)

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={Boolean(state.refreshing)} onRefresh={() => void onRefresh()} tintColor={palette.primary} />}>
        <View style={styles.page}>
          <PageHeader palette={palette}
            provenance={t('portfolios.helper')} title={t('portfolios.title')} />
          {state.status === 'refresh-error' ? <Text accessibilityRole="alert" allowFontScaling style={[styles.banner, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.muted }]}>{t('portfolios.stale')}</Text> : null}
          <View style={styles.actions}>
            {data.portfolioCount === 0 ? <Button label={t('portfolios.activity')} onPress={onOpenActivity} palette={palette} variant="secondary" /> : null}
            {data.portfolioCount > 0 ? <><Button label={t('portfolios.create')} onPress={onCreatePortfolio} palette={palette} variant="primary" /><Button label={t('portfolios.activity')} onPress={onOpenActivity} palette={palette} variant="secondary" /></> : null}
          </View>

          {data.portfolioCount === 0 ? (
            <View style={[styles.empty, { borderColor: palette.border, backgroundColor: palette.card }]}>
              <View style={styles.emptyHeader}>
                <View style={styles.emptyCopy}>
                  <Text allowFontScaling style={[styles.emptyTitle, { color: palette.foreground }]}>{t('portfolios.emptyTitle')}</Text>
                  <Text allowFontScaling style={[styles.helper, { color: palette.mutedForeground }]}>{t('portfolios.empty')}</Text>
                </View>
                <PreviewLabel />
              </View>
              {/* Background-step, not a second border — the outer empty-state
                  card already has one (No-Nesting rule). */}
              <View style={[styles.preview, { backgroundColor: palette.muted }]}>
                <Text allowFontScaling style={[styles.eyebrow, { color: palette.mutedForeground }]}>{t('portfolios.previewValue')}</Text>
                <Text allowFontScaling style={[styles.previewAmount, { color: palette.foreground }]}>{money(24680.5, data.currency)}</Text>
                <View style={styles.previewMetrics}>
                  <Metric label={t('portfolios.gainLoss')} value={money(1840, data.currency)} palette={palette} tone="positive" />
                  <Metric label={t('portfolios.ytdReturn')} value={percent(12.4)} palette={palette} tone="positive" />
                </View>
                <Text allowFontScaling style={[styles.eyebrow, { color: palette.mutedForeground }]}>{t('portfolios.previewAllocation')}</Text>
                <View accessibilityLabel={t('portfolios.previewAllocation')} style={styles.allocationBar}>
                  {previewHoldings.map((holding) => <View key={holding.symbol} style={[styles.allocationSegment, { flex: holding.allocation, backgroundColor: palette.primary }]} />)}
                </View>
                <View style={styles.previewRows}>{previewHoldings.slice(0, 3).map((holding) => <View key={holding.symbol} style={styles.previewRow}><Text allowFontScaling style={[styles.rowName, { color: palette.foreground }]}>{holding.symbol}</Text><Text allowFontScaling style={[styles.rowMeta, { color: palette.mutedForeground }]}>{percent(holding.allocation)}</Text></View>)}</View>
              </View>
              <Button label={t('portfolios.create')} onPress={onCreatePortfolio} palette={palette} variant="primary" />
            </View>
          ) : (
            <>
              <View style={[styles.hero, { backgroundColor: palette.muted, borderColor: palette.border }]}>
                <Text allowFontScaling style={[styles.eyebrow, { color: palette.mutedForeground }]}>{t('portfolios.totalValue')}</Text>
                <Text allowFontScaling style={[styles.heroAmount, { color: palette.foreground }]}>{money(data.totalValue, data.currency)}</Text>
                <View style={styles.metrics}>
                  <Metric label={t('portfolios.gainLoss')} value={`${money(data.totalGainLoss, data.currency)} · ${percent(data.totalGainLossPercent)}`} palette={palette} tone={tone(data.totalGainLoss)} />
                  <Metric label={t('portfolios.ytdReturn')} value={periodReturn} palette={palette} tone={data.periodReturn === null ? 'muted' : tone(data.periodReturn)} />
                </View>
              </View>
              <View style={styles.counts}>
                <Metric label={t('portfolios.portfolioCount')} value={String(data.portfolioCount)} palette={palette} />
                <Metric label={t('portfolios.assetCount')} value={String(data.assetCount)} palette={palette} />
              </View>
              <View style={styles.section}>
                <Text accessibilityRole="header" allowFontScaling style={[styles.sectionTitle, { color: palette.foreground }]}>{t('portfolios.listTitle')}</Text>
                <View style={[styles.list, { borderColor: palette.border }]}>
                  {data.portfolios.map((portfolio, index) => {
                    const value = money(portfolio.value, portfolio.currency)
                    const gain = percent(portfolio.gainPercent)
                    return (
                      <Pressable key={portfolio.id} testID="portfolio-row" accessibilityRole="button" accessibilityLabel={[portfolio.name, value, `${t('portfolios.gainLoss')} ${gain}`, t('portfolios.viewDetails')].join(', ')} onPress={() => onSelectPortfolio(portfolio.id)} style={({ pressed }) => [styles.row, index > 0 && { borderTopWidth: 1, borderTopColor: palette.border }, pressed && styles.pressed]}>
                        <View style={styles.rowMain}>
                          <Text allowFontScaling style={[styles.rowName, { color: palette.foreground }]}>{portfolio.name}</Text>
                          {portfolio.description ? <Text allowFontScaling style={[styles.rowMeta, { color: palette.mutedForeground }]}>{portfolio.description}</Text> : null}
                          <Text allowFontScaling style={[styles.rowMeta, { color: palette.mutedForeground }]}>{t('portfolios.nativeCurrency', { currency: portfolio.nativeCurrency })}</Text>
                        </View>
                        <View style={styles.rowValues}>
                          <Text allowFontScaling style={[styles.rowAmount, { color: palette.foreground }]}>{value}</Text>
                          <Text allowFontScaling style={[styles.rowPercent, { color: tone(portfolio.gainPercent) === 'positive' ? palette.successText : tone(portfolio.gainPercent) === 'negative' ? palette.destructiveText : palette.mutedForeground }]}>{gain}</Text>
                          <Text allowFontScaling style={[styles.viewLabel, { color: palette.primary }]}>{t('portfolios.viewDetails')}</Text>
                        </View>
                      </Pressable>
                    )
                  })}
                </View>
              </View>
            </>
          )}
          <PortfolioAnalyticsPanel state={analyticsState} locale={locale} palette={palette} onEnable={onEnableAnalytics} onRetry={onRetryAnalytics} />
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 }, content: { flexGrow: 1, padding: themeTokens.layout.screenPadding }, page: { width: '100%', maxWidth: 800, alignSelf: 'center', gap: themeTokens.layout.blockGap },
  header: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: themeTokens.spacing[4] }, heading: { flex: 1, minWidth: 220, gap: themeTokens.spacing[2] },
  title: { ...textStyles.title }, helper: { ...textStyles.body },
  banner: { ...textStyles.body, borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4] },
  hero: { borderWidth: 1, borderRadius: themeTokens.radius.xl, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] }, eyebrow: { ...textStyles.meta }, heroAmount: { ...textStyles.display },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[5], paddingTop: themeTokens.spacing[2] }, counts: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[5] },
  section: { gap: themeTokens.spacing[3] }, sectionTitle: { ...textStyles.section }, list: { borderWidth: 1, borderRadius: themeTokens.radius.lg, overflow: 'hidden' },
  row: { minHeight: 96, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: themeTokens.spacing[4], padding: themeTokens.spacing[4] }, rowMain: { flex: 1, minWidth: 170, gap: themeTokens.spacing[1] }, rowName: { ...textStyles.section }, rowMeta: { ...textStyles.meta }, rowValues: { alignItems: 'flex-end', gap: themeTokens.spacing[1] }, rowAmount: { ...textStyles.amount }, rowPercent: { ...textStyles.amount }, viewLabel: { ...textStyles.meta, fontWeight: '600' as const },
  empty: { borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[5], gap: themeTokens.spacing[4] }, emptyHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: themeTokens.spacing[3] }, emptyCopy: { flex: 1, gap: themeTokens.spacing[2] }, emptyTitle: { ...textStyles.section }, preview: { borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] }, previewAmount: { ...textStyles.display }, previewMetrics: { flexDirection: 'row', gap: themeTokens.spacing[4] }, allocationBar: { height: 8, flexDirection: 'row', overflow: 'hidden', borderRadius: themeTokens.radius.sm, gap: 1 }, allocationSegment: { height: '100%' }, previewRows: { gap: themeTokens.spacing[2] }, previewRow: { flexDirection: 'row', justifyContent: 'space-between' }, pressed: { opacity: 0.72 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[3] },
})
