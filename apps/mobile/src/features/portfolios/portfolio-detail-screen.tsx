import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native'

import { BackControl } from '@/components/ui/back-control'
import { Button } from '@/components/ui/button'
import { EntityMark, portfolioMark } from '@/components/ui/entity-mark'
import { FLOATING_ACTION_SIZE, FloatingActionButton } from '@/components/ui/floating-action-button'
import { Icon } from '@/components/ui/icon'
import { IconButton } from '@/components/ui/icon-button'
import { List, ListRow } from '@/components/ui/list-row'
import { ObjectHeader } from '@/components/ui/page-header'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Section } from '@/components/ui/section'
import { OptionSheet } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import type { PortfolioDividendIncomeViewModel } from './portfolio-activity-view-model'
import { PortfolioPerformanceChart, type PortfolioPerformanceChartProps } from './portfolio-performance-chart'
import { PortfolioFailure, PortfolioLoading } from './portfolio-screen-parts'
import {
  DividendIncomeBody,
  hasDividendIncome,
  HoldingsList,
  PortfolioAllocationSection,
  PortfolioQuickStatsSection,
  PortfolioSummaryStats,
  PortfolioTopMoversSection,
} from './portfolio-sections'
import type { PortfolioAllocationDto, PortfolioTopMoversDto } from './portfolios-contract'
import type { PortfolioDetailViewModel } from './portfolios-view-model'
import type { PortfolioResourceState } from './use-portfolio-resource'

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
  allocation?: PortfolioResourceState<PortfolioAllocationDto>
  topMovers?: PortfolioResourceState<PortfolioTopMoversDto>
  onBack: () => void
  onOpenActivity: () => void
  onOpenSettings?: () => void
  onOpenImport?: () => void
  onOpenAddTransaction?: () => void
  onOpenHolding?: (assetId: number) => void
  onRefresh: () => void | Promise<void>
  onLogout: () => void | Promise<void>
}

/**
 * Web's portfolio page (`[portfolioId]/portfolio-client.tsx`), laid out for a phone: "←
 * Portfolio", then the portfolio's mark and name with a ⋮ (Portfolio settings, Import
 * transactions), the total value as the headline figure and the other summary figures in a
 * two-column grid. Holdings follow straight away, then Performance, Allocation, Top Movers,
 * Quick Stats and Dividend Income (when there is any), and the activity list as a row at the
 * end. Adding a transaction is the floating "+".
 */
export function PortfolioDetailScreen({ state, performance, dividendIncome = { status: 'idle' }, allocation, topMovers, onBack, onOpenActivity, onOpenSettings = () => undefined, onOpenImport = () => undefined, onOpenAddTransaction = () => undefined, onOpenHolding = () => undefined, onRefresh, onLogout }: PortfolioDetailScreenProps) {
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const [menuOpen, setMenuOpen] = useState(false)
  if (state.status === 'access-transition') return null
  if (state.status === 'loading') return <PortfolioLoading label={t('portfolioDetail.loading')} palette={palette} onBack={onBack} backLabel={t('portfolioDetail.back')} />
  if (state.status === 'error' || state.status === 'not-found' || state.status === 'invalid-id' || state.status === 'invalid-response') {
    const key = state.status === 'not-found' ? 'notFound' : state.status === 'invalid-id' ? 'invalidId' : state.status === 'invalid-response' ? 'invalidResponse' : 'error'
    return <PortfolioFailure title={t(`portfolioDetail.${key}.title`)} message={t(`portfolioDetail.${key}.message`)} retryLabel={t('common.retry')} signOutLabel={t('common.signOut')} backLabel={t('portfolioDetail.back')} onRetry={onRefresh} onSignOut={onLogout} onBack={onBack} canRetry={state.status === 'error' || state.status === 'invalid-response'} palette={palette} />
  }

  const { data } = state
  const noHoldings = data.holdings.length === 0
  const runMenu = (value: 'settings' | 'import') => (value === 'settings' ? onOpenSettings() : onOpenImport())
  return (
    <View style={styles.safeArea}>
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={[styles.content, styles.contentUnderButton]} refreshControl={<RefreshControl refreshing={Boolean(state.refreshing)} onRefresh={() => void onRefresh()} tintColor={palette.primary} />}>
        <View style={styles.page}>
          <View style={styles.header}>
            <BackControl fallback="/portfolio" onPress={onBack} label={t('portfolioDetail.back')} />
            <ObjectHeader
              title={data.name}
              descriptor={data.description ?? undefined}
              leading={<EntityMark {...portfolioMark()} />}
              action={<IconButton accessibilityLabel={t('portfolioSections.more')} icon="more-vertical" onPress={() => setMenuOpen(true)} testID="portfolio-detail-more" />}
            />
            {noHoldings ? null : <PortfolioSummaryStats figures={data} locale={locale} />}
          </View>
          {state.status === 'refresh-error' ? (
            <View style={[styles.banner, { borderColor: palette.border, backgroundColor: palette.muted }]}>
              <Text accessibilityRole="alert" variant="meta">{t('portfolioDetail.stale')}</Text>
              <Button label={t('common.retry')} onPress={onRefresh} size="sm" variant="secondary" />
            </View>
          ) : null}

          {noHoldings ? (
            // Web's dashed empty block: what to do next, and the one action that does it.
            <View style={[styles.empty, { borderColor: palette.border, backgroundColor: palette.card }]}>
              <Text variant="bodyStrong">{t('portfolioSections.emptyTitle')}</Text>
              <Text style={styles.centeredText} tone="muted" variant="meta">{t('portfolioSections.emptyDescription')}</Text>
              <Button icon="plus" label={t('portfolioDetail.addTransaction')} onPress={onOpenAddTransaction} variant="primary" />
            </View>
          ) : (
            <>
              {/* The holdings come first, straight under the figures. */}
              <Section title={t('portfolioSections.holdings')} variant="open">
                <HoldingsList holdings={data.holdings} locale={locale} onOpen={(holding) => onOpenHolding(holding.id)} />
              </Section>
              <PortfolioPerformanceChart {...performance} palette={palette} />
              {allocation ? <PortfolioAllocationSection locale={locale} state={allocation} title={t('portfolioSections.allocation')} /> : null}
              {topMovers ? <PortfolioTopMoversSection currency={data.currency} locale={locale} state={topMovers} /> : null}
              <PortfolioQuickStatsSection bestPerformer={data.bestPerformer} biggestPosition={data.biggestPosition} holdingsCount={data.holdingsCount} locale={locale} worstPerformer={data.worstPerformer} />
              {dividendIncome.status === 'loaded' && hasDividendIncome(dividendIncome.data) ? (
                <Section title={t('portfolioSections.dividendIncome')} variant="open">
                  <DividendIncomeBody data={dividendIncome.data} locale={locale} />
                </Section>
              ) : null}
            </>
          )}

          {/* The portfolio's own ledger, one row at the end; web reaches it from its transactions route. */}
          <List divided testID="portfolio-secondary-actions">
            <ListRow density="comfortable" title={t('portfolioDetail.activity')} onPress={onOpenActivity} figure={<Icon color={palette.mutedForeground} name="chevron-right" size={16} />} />
          </List>
        </View>
      </ScrollView>
      {/* Settings and import sit behind the title row's overflow; adding is the floating "+". */}
      <OptionSheet
        mode="menu"
        onClose={() => setMenuOpen(false)}
        onSelect={runMenu}
        options={[
          { value: 'settings' as const, label: t('portfolioDetail.settings') },
          { value: 'import' as const, label: t('portfolioDetail.import') },
        ]}
        title={t('portfolioSections.more')}
        visible={menuOpen}
      />
    </SafeAreaView>
    <FloatingActionButton accessibilityLabel={t('portfolioDetail.addTransaction')} onPress={onOpenAddTransaction} testID="portfolio-detail-add" />
    </View>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[12] },
  contentUnderButton: { paddingBottom: FLOATING_ACTION_SIZE + themeTokens.spacing[8] },
  // Space, not rules, between the sections: 40pt and a 20/600 heading.
  page: { width: '100%', maxWidth: 800, alignSelf: 'center', gap: themeTokens.spacing[10] },
  header: { gap: themeTokens.spacing[6] },
  banner: { borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3], alignItems: 'flex-start' },
  empty: { borderWidth: 1, borderStyle: 'dashed', borderRadius: themeTokens.radius.lg, paddingVertical: themeTokens.spacing[12], paddingHorizontal: themeTokens.spacing[6], alignItems: 'center', gap: themeTokens.spacing[4] },
  centeredText: { textAlign: 'center' },
})
