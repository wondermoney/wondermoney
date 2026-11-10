import { useTranslation } from 'react-i18next'
import { StyleSheet, Text, View } from 'react-native'
import { CartesianChart, Line } from 'victory-native'

import { SegmentedControl } from '@/components/ui/segmented-control'
import { Section } from '@/components/ui/section'
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
    <Section title={t('assetDetail.priceChart.heading')} variant="open">
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
        <Text accessibilityRole="alert" allowFontScaling style={[styles.helper, { color: palette.destructiveText }]}>
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
    </Section>
  )
}

const styles = StyleSheet.create({
  periods: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
  helper: { ...textStyles.meta },
  chart: { width: '100%', height: 200 },
})
