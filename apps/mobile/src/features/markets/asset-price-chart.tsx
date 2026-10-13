import { useTranslation } from 'react-i18next'
import { StyleSheet, Text, View } from 'react-native'
import { CartesianChart, Line } from 'victory-native'

import { SegmentedControl } from '@/components/ui/segmented-control'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import { type Palette } from './markets-screen-parts'
import type { AssetPriceChartPoint } from './markets-view-model'
import { HISTORICAL_PRICE_PERIODS, type HistoricalPricePeriod } from './markets-contract'

export type AssetPriceChartState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'loaded'; points: readonly AssetPriceChartPoint[] }

export type AssetPriceChartProps = Readonly<{
  state: AssetPriceChartState
  period: HistoricalPricePeriod
  onSelectPeriod: (period: HistoricalPricePeriod) => void
  palette: Palette
}>

export function AssetPriceChart({ state, period, onSelectPeriod, palette }: AssetPriceChartProps) {
  const { t } = useTranslation()
  return (
    <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.muted }]}>
      <Text accessibilityRole="header" allowFontScaling style={[styles.title, { color: palette.foreground }]}>
        {t('assetDetail.priceChart.heading')}
      </Text>
      <SegmentedControl
        accessibilityLabel={t('assetDetail.priceChart.title')}
        onChange={onSelectPeriod}
        options={HISTORICAL_PRICE_PERIODS.map((value) => ({
          value,
          label: t(`assetDetail.priceChart.periods.${value}`),
        }))}
        value={period}
      />

      {state.status === 'loading' ? (
        <Text accessibilityRole="progressbar" accessibilityLabel={t('assetDetail.priceChart.loading')} allowFontScaling style={[styles.helper, { color: palette.mutedForeground }]}>
          {t('assetDetail.priceChart.loading')}
        </Text>
      ) : state.status === 'error' ? (
        <Text accessibilityRole="alert" allowFontScaling style={[styles.helper, { color: palette.destructive }]}>
          {t('assetDetail.priceChart.error')}
        </Text>
      ) : state.points.length < 2 ? (
        <Text allowFontScaling style={[styles.helper, { color: palette.mutedForeground }]}>
          {t('assetDetail.priceChart.empty')}
        </Text>
      ) : (
        // CartesianChart/Line render onto a Skia canvas with no screen-reader-navigable content of
        // its own, so this container gets a static label (the section heading) to stand in for an
        // otherwise silent blank region.
        <View testID="asset-price-chart" accessible accessibilityLabel={t('assetDetail.priceChart.heading')} style={styles.chart}>
          <CartesianChart data={[...state.points]} xKey="x" yKeys={['value']}>
            {({ points }) => <Line points={points.value} color={palette.chart1} strokeWidth={2} curveType="linear" />}
          </CartesianChart>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.xl, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] },
  title: { ...textStyles.section },
  periods: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
  helper: { ...textStyles.body },
  chart: { width: '100%', height: 200 },
})
