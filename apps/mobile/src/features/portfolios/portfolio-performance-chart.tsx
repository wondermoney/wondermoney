import { useTranslation } from 'react-i18next'
import { StyleSheet, Text, View } from 'react-native'
import { CartesianChart, Line, Scatter } from 'victory-native'

import { Section } from '@/components/ui/section'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { useFormatMoney } from '@/lib/formatters/money-display'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import type { PortfolioPerformanceFlow, PortfolioPerformanceViewModel } from './portfolio-performance-view-model'
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
  /** The currency the history is valued in (the viewer's), for the deposit and withdrawal amounts. */
  currency?: string | null
}>

/** The latest flows listed under the chart; the activity list has the rest. */
const LISTED_FLOWS = 5

/** 'YYYY-MM-DD' → "1 Jul 2026" in the reader's locale, read as a calendar day (UTC). */
export function formatDay(date: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00.000Z`))
  } catch {
    return date
  }
}

/**
 * The value of the portfolio over the period, with a small marker on each day money went in or
 * out (a deposit lifts the value without being a gain), and the time-weighted return beneath,
 * which those flows don't move. The latest flows are listed with their amounts, since the chart
 * has no point to select.
 */
export function PortfolioPerformanceChart({ state, period, onSelectPeriod, palette, currency = null }: PortfolioPerformanceChartProps) {
  const { t, i18n } = useTranslation()
  const formatMoney = useFormatMoney()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  // The history's own currency when the API names it, else the page's (both are the viewer's).
  const flowCurrency = (state.status === 'loaded' ? state.data.currencyCode : null) ?? currency
  const flowLabel = (flow: PortfolioPerformanceFlow) => flow.amount === null
    ? t('portfolioDetail.performance.flowUnknown')
    : t(flow.kind === 'deposit' ? 'portfolioDetail.performance.deposit' : 'portfolioDetail.performance.withdrawal', { amount: formatMoney(flow.amount, { locale, currency: flowCurrency }) })
  // The latest days had no snapshot, so the return stops short of the value line: say as of when.
  const returnLagging = state.status === 'loaded' && state.data.returnEndDate !== null && state.data.endDate !== null && state.data.returnEndDate < state.data.endDate
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
            <CartesianChart data={[...state.data.points]} xKey="x" yKeys={['value', 'flow']}>
              {({ points }) => (
                <>
                  <Line points={points.value} color={palette.chart1} strokeWidth={2} curveType="linear" />
                  {/* Days with a deposit or withdrawal: a small dot on the line, in ink, not a gain colour. */}
                  <Scatter points={points.flow} color={palette.foreground} radius={3.5} />
                </>
              )}
            </CartesianChart>
          </View>
          <View
            accessible
            accessibilityLabel={[
              state.data.totalReturnPercent !== null ? `${t('portfolioDetail.performance.returnLabel')}, ${t('portfolioDetail.performance.totalReturn', { value: state.data.totalReturnPercent.toFixed(1) })}` : null,
              returnLagging ? t('portfolioDetail.performance.returnAsOf', { date: formatDay(state.data.returnEndDate as string, locale) }) : null,
              state.data.startDate && state.data.endDate ? t('portfolioDetail.performance.range', { start: state.data.startDate, end: state.data.endDate }) : null,
            ].filter(Boolean).join(', ')}
            style={styles.summary}
          >
            {state.data.totalReturnPercent !== null ? (
              <View style={styles.returnRow}>
                <Text allowFontScaling style={[styles.helper, { color: palette.mutedForeground }]}>{t('portfolioDetail.performance.returnLabel')}</Text>
                <Text allowFontScaling style={[styles.returnText, { color: state.data.totalReturnPercent >= 0 ? palette.successText : palette.destructiveText }]}>
                  {t('portfolioDetail.performance.totalReturn', { value: state.data.totalReturnPercent.toFixed(1) })}
                </Text>
                {returnLagging ? (
                  <Text allowFontScaling style={[styles.label, { color: palette.mutedForeground }]}>
                    {t('portfolioDetail.performance.returnAsOf', { date: formatDay(state.data.returnEndDate as string, locale) })}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {state.data.startDate && state.data.endDate ? (
              <Text allowFontScaling style={[styles.helper, { color: palette.mutedForeground }]}>
                {t('portfolioDetail.performance.range', { start: state.data.startDate, end: state.data.endDate })}
              </Text>
            ) : null}
          </View>
          {state.data.flows.length > 0 ? (
            <View style={styles.flows} testID="portfolio-performance-flows">
              <Text allowFontScaling style={[styles.label, { color: palette.mutedForeground }]}>{t('portfolioDetail.performance.flowMarkers')}</Text>
              {[...state.data.flows].reverse().slice(0, LISTED_FLOWS).map((flow) => (
                <View accessible accessibilityLabel={`${formatDay(flow.date, locale)}, ${flowLabel(flow)}`} key={flow.date} style={styles.flowRow} testID="portfolio-performance-flow">
                  <Text allowFontScaling style={[styles.helper, { color: palette.mutedForeground }]}>{formatDay(flow.date, locale)}</Text>
                  <Text allowFontScaling style={[styles.flowAmount, { color: palette.foreground }]}>{flowLabel(flow)}</Text>
                </View>
              ))}
              {state.data.flows.length > LISTED_FLOWS ? (
                <Text allowFontScaling style={[styles.label, { color: palette.mutedForeground }]}>
                  {t('portfolioDetail.performance.flowsMore', { count: state.data.flows.length - LISTED_FLOWS })}
                </Text>
              ) : null}
            </View>
          ) : null}
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
  returnRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: themeTokens.spacing[2] },
  returnText: { ...textStyles.amount },
  label: { ...textStyles.label },
  flows: { gap: themeTokens.spacing[2] },
  flowRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: themeTokens.spacing[3] },
  flowAmount: { ...textStyles.amount, flexShrink: 1, textAlign: 'right' },
})
