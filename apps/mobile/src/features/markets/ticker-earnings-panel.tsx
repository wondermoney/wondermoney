import { useTranslation } from 'react-i18next'
import { StyleSheet, Text, View } from 'react-native'
import { CartesianChart, Scatter } from 'victory-native'

import { formatCurrency } from '@/lib/formatters/financial'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import { type Palette } from './markets-screen-parts'
import type { EarningsChartPoint } from './markets-view-model'

export type TickerEarningsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'loaded'; points: readonly EarningsChartPoint[] }

export type TickerEarningsPanelProps = Readonly<{
  state: TickerEarningsState
  palette: Palette
}>

/** EPS is a provider figure reported in USD regardless of the ticker's trading currency, matching the web client. */
const STATEMENT_CURRENCY = 'USD'

function EarningsSummaryRow({ point, locale, unavailable, palette }: { point: EarningsChartPoint; locale: string; unavailable: string; palette: Palette }) {
  const { t } = useTranslation()
  const actualText = point.actual === null ? unavailable : formatCurrency(point.actual, { locale, currency: STATEMENT_CURRENCY })
  const estimatedText = point.estimated === null ? unavailable : formatCurrency(point.estimated, { locale, currency: STATEMENT_CURRENCY })
  return (
    <Text allowFontScaling style={[styles.summaryRow, { color: palette.foreground }]}>
      {t('assetDetail.earnings.row', { quarter: point.quarter || unavailable, actual: actualText, estimated: estimatedText })}
    </Text>
  )
}

export function TickerEarningsPanel({ state, palette }: TickerEarningsPanelProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const unavailable = t('assetDetail.unavailable')

  return (
    <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.muted }]}>
      <Text accessibilityRole="header" allowFontScaling style={[styles.title, { color: palette.foreground }]}>
        {t('assetDetail.earnings.heading')}
      </Text>

      {state.status === 'loading' ? (
        <Text accessibilityRole="progressbar" accessibilityLabel={t('assetDetail.earnings.loading')} allowFontScaling style={[styles.helper, { color: palette.mutedForeground }]}>
          {t('assetDetail.earnings.loading')}
        </Text>
      ) : state.status === 'error' ? (
        <Text accessibilityRole="alert" allowFontScaling style={[styles.helper, { color: palette.destructive }]}>
          {t('assetDetail.earnings.error')}
        </Text>
      ) : state.points.length === 0 ? (
        <Text allowFontScaling style={[styles.helper, { color: palette.mutedForeground }]}>
          {t('assetDetail.earnings.empty')}
        </Text>
      ) : (
        <>
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: palette.chart1 }]} />
              <Text allowFontScaling style={[styles.legendLabel, { color: palette.mutedForeground }]}>{t('assetDetail.earnings.actual')}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: palette.chart2 }]} />
              <Text allowFontScaling style={[styles.legendLabel, { color: palette.mutedForeground }]}>{t('assetDetail.earnings.estimated')}</Text>
            </View>
          </View>

          {/* Scatter renders onto a Skia canvas with no screen-reader-navigable content of its
              own, so this container gets a static label, and the numeric values are additionally
              rendered as plain text below (not chart-only), per the "accessible text summaries
              accompany visual data" requirement. */}
          <View testID="ticker-earnings-chart" accessible accessibilityLabel={t('assetDetail.earnings.heading')} style={styles.chart}>
            <CartesianChart data={[...state.points]} xKey="quarter" yKeys={['actual', 'estimated']}>
              {({ points }) => (
                <>
                  <Scatter points={points.actual} color={palette.chart1} radius={5} />
                  <Scatter points={points.estimated} color={palette.chart2} radius={5} />
                </>
              )}
            </CartesianChart>
          </View>

          <View style={styles.summary}>
            <Text allowFontScaling style={[styles.summaryHeading, { color: palette.mutedForeground }]}>
              {t('assetDetail.earnings.summaryHeading')}
            </Text>
            {state.points.map((point, index) => (
              <EarningsSummaryRow key={`${point.quarter}-${index}`} point={point} locale={locale} unavailable={unavailable} palette={palette} />
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
  legendSwatch: { width: 10, height: 10, borderRadius: themeTokens.radius.pill },
  legendLabel: { ...textStyles.meta },
  chart: { width: '100%', height: 200 },
  summary: { gap: themeTokens.spacing[1] },
  summaryHeading: { ...textStyles.meta, fontWeight: '600' as const },
  summaryRow: { ...textStyles.amount },
})
