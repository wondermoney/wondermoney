import { useTranslation } from 'react-i18next'
import { StyleSheet, Text, View } from 'react-native'
import { BarGroup, CartesianChart } from 'victory-native'

import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import { type Palette } from './markets-screen-parts'
import type { FinancialsChartPoint } from './markets-view-model'

export type TickerFinancialsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'loaded'; points: readonly FinancialsChartPoint[] }

export type TickerFinancialsPanelProps = Readonly<{
  state: TickerFinancialsState
  palette: Palette
}>

/** Revenue/net income are provider figures reported in USD regardless of the ticker's trading currency, matching the web client. */
const STATEMENT_CURRENCY = 'USD'

function compactAmountText(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', style: 'currency', currency: STATEMENT_CURRENCY, maximumFractionDigits: 1 }).format(value)
}

function FinancialsSummaryRow({ point, locale, unavailable, palette }: { point: FinancialsChartPoint; locale: string; unavailable: string; palette: Palette }) {
  const { t } = useTranslation()
  const revenueText = point.revenue === null ? unavailable : compactAmountText(point.revenue, locale)
  const netIncomeText = point.netIncome === null ? unavailable : compactAmountText(point.netIncome, locale)
  return (
    <Text allowFontScaling style={[styles.summaryRow, { color: palette.foreground }]}>
      {t('assetDetail.financials.row', { period: point.period || unavailable, revenue: revenueText, netIncome: netIncomeText })}
    </Text>
  )
}

export function TickerFinancialsPanel({ state, palette }: TickerFinancialsPanelProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const unavailable = t('assetDetail.unavailable')

  return (
    <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.muted }]}>
      <Text accessibilityRole="header" allowFontScaling style={[styles.title, { color: palette.foreground }]}>
        {t('assetDetail.financials.heading')}
      </Text>

      {state.status === 'loading' ? (
        <Text accessibilityRole="progressbar" accessibilityLabel={t('assetDetail.financials.loading')} allowFontScaling style={[styles.helper, { color: palette.mutedForeground }]}>
          {t('assetDetail.financials.loading')}
        </Text>
      ) : state.status === 'error' ? (
        <Text accessibilityRole="alert" allowFontScaling style={[styles.helper, { color: palette.destructive }]}>
          {t('assetDetail.financials.error')}
        </Text>
      ) : state.points.length === 0 ? (
        <Text allowFontScaling style={[styles.helper, { color: palette.mutedForeground }]}>
          {t('assetDetail.financials.empty')}
        </Text>
      ) : (
        <>
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: palette.chart1 }]} />
              <Text allowFontScaling style={[styles.legendLabel, { color: palette.mutedForeground }]}>{t('assetDetail.financials.revenue')}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: palette.chart2 }]} />
              <Text allowFontScaling style={[styles.legendLabel, { color: palette.mutedForeground }]}>{t('assetDetail.financials.netIncome')}</Text>
            </View>
          </View>

          {/* BarGroup renders onto a Skia canvas with no screen-reader-navigable content of its
              own, so this container gets a static label, and the numeric values are additionally
              rendered as plain text below (not chart-only), per the "accessible text summaries
              accompany visual data" requirement. */}
          <View testID="ticker-financials-chart" accessible accessibilityLabel={t('assetDetail.financials.heading')} style={styles.chart}>
            <CartesianChart data={[...state.points]} xKey="period" yKeys={['revenue', 'netIncome']}>
              {({ points, chartBounds }) => (
                <BarGroup chartBounds={chartBounds} betweenGroupPadding={0.3} withinGroupPadding={0.2}>
                  <BarGroup.Bar points={points.revenue} color={palette.chart1} />
                  <BarGroup.Bar points={points.netIncome} color={palette.chart2} />
                </BarGroup>
              )}
            </CartesianChart>
          </View>

          <View style={styles.summary}>
            <Text allowFontScaling style={[styles.summaryHeading, { color: palette.mutedForeground }]}>
              {t('assetDetail.financials.summaryHeading')}
            </Text>
            {state.points.map((point, index) => (
              <FinancialsSummaryRow key={`${point.period}-${index}`} point={point} locale={locale} unavailable={unavailable} palette={palette} />
            ))}
          </View>
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.xl, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] },
  title: { ...textStyles.section },
  helper: { ...textStyles.body },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[4] },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2] },
  legendSwatch: { width: 10, height: 10, borderRadius: themeTokens.radius.sm },
  legendLabel: { ...textStyles.meta },
  chart: { width: '100%', height: 200 },
  summary: { gap: themeTokens.spacing[1] },
  summaryHeading: { ...textStyles.meta, fontWeight: '600' as const },
  summaryRow: { ...textStyles.amount },
})
