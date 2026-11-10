import { useTranslation } from 'react-i18next'
import { StyleSheet, Text, View } from 'react-native'
import { CartesianChart, Line } from 'victory-native'

import { Section } from '@/components/ui/section'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import type { PortfolioPerformanceViewModel } from './portfolio-performance-view-model'
import { PORTFOLIO_PERFORMANCE_PERIODS, type PortfolioPerformancePeriod } from './portfolios-contract'

export type PortfolioPerformanceState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'loaded'; data: PortfolioPerformanceViewModel }

export type PortfolioPerformanceChartProps = Readonly<{
  state: PortfolioPerformanceState
  period: PortfolioPerformancePeriod
  /** Omit where the page's own period select drives the chart (the overview, as web). */
  onSelectPeriod?: (period: PortfolioPerformancePeriod) => void
  palette: Palette
}>

export function PortfolioPerformanceChart({ state, period, onSelectPeriod, palette }: PortfolioPerformanceChartProps) {
  const { t } = useTranslation()
  return (
    // Web's ruled "Performance" section: the chart on the canvas, no card around it.
    <Section title={t('portfolioDetail.performance.heading')} variant="open" style={styles.card}>
      {onSelectPeriod ? <SegmentedControl
        accessibilityLabel={t('portfolioDetail.performance.title')}
        onChange={onSelectPeriod}
        options={PORTFOLIO_PERFORMANCE_PERIODS.map((value) => ({
          value,
          label: t(`portfolioDetail.performance.periods.${value}`),
        }))}
        // Six period options (1M/3M/6M/YTD/1Y/All) don't reliably fit a
        // narrow phone in one non-wrapping row — scroll rather than clip.
        scrollable
        value={period}
      /> : null}

      {state.status === 'loading' ? (
        <View accessible accessibilityRole="progressbar" accessibilityLabel={t('portfolioDetail.performance.loading')} style={[styles.placeholder, { backgroundColor: palette.muted }]} />
      ) : state.status === 'error' ? (
        <Text accessibilityRole="alert" allowFontScaling style={[styles.helper, { color: palette.destructiveText }]}>
          {t('portfolioDetail.performance.error')}
        </Text>
      ) : state.data.historyStatus !== 'ready' || state.data.points.length < 2 ? (
        <Text allowFontScaling style={[styles.helper, styles.emptyCopy, { color: palette.mutedForeground }]}>
          {t(state.data.historyStatus === 'empty' ? 'portfolioDetail.performance.empty' : 'portfolioDetail.performance.insufficientHistory')}
        </Text>
      ) : (
        <>
          {/* CartesianChart/Line render onto a Skia canvas with no screen-reader-navigable content
              of its own, so this container gets a static label (the section heading) to stand in
              for an otherwise silent blank region — see the grouped summary below for the actual
              return/range figures. */}
          <View testID="portfolio-performance-chart" accessible accessibilityLabel={t('portfolioDetail.performance.heading')} style={styles.chart}>
            <CartesianChart data={[...state.data.points]} xKey="x" yKeys={['value']}>
              {({ points }) => <Line points={points.value} color={palette.chart1} strokeWidth={2} curveType="linear" />}
            </CartesianChart>
          </View>
          <View
            accessible
            accessibilityLabel={[
              state.data.totalReturnPercent !== null ? t('portfolioDetail.performance.totalReturn', { value: state.data.totalReturnPercent.toFixed(1) }) : null,
              state.data.startDate && state.data.endDate ? t('portfolioDetail.performance.range', { start: state.data.startDate, end: state.data.endDate }) : null,
            ].filter(Boolean).join(', ')}
            style={styles.summary}
          >
            {state.data.totalReturnPercent !== null ? (
              <Text allowFontScaling style={[styles.returnText, { color: state.data.totalReturnPercent >= 0 ? palette.successText : palette.destructiveText }]}>
                {t('portfolioDetail.performance.totalReturn', { value: state.data.totalReturnPercent.toFixed(1) })}
              </Text>
            ) : null}
            {state.data.startDate && state.data.endDate ? (
              <Text allowFontScaling style={[styles.helper, { color: palette.mutedForeground }]}>
                {t('portfolioDetail.performance.range', { start: state.data.startDate, end: state.data.endDate })}
              </Text>
            ) : null}
          </View>
          {state.data.currencyIncomplete ? (
            <Text allowFontScaling style={[styles.helper, { color: palette.warningText }]}>
              {t('portfolioDetail.performance.currencyIncomplete')}
            </Text>
          ) : null}
        </>
      )}
    </Section>
  )
}

const styles = StyleSheet.create({
  card: { width: '100%' },
  placeholder: { width: '100%', height: 240, borderRadius: themeTokens.radius.md },
  emptyCopy: { paddingVertical: themeTokens.spacing[10], textAlign: 'center' },
  title: { ...textStyles.section },
  periods: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
  helper: { ...textStyles.meta },
  chart: { width: '100%', height: 240 },
  summary: { gap: themeTokens.spacing[1] },
  returnText: { ...textStyles.amount },
})
