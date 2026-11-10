import { StyleSheet, View } from 'react-native'
import { Area, CartesianChart, Line } from 'victory-native'

import { Text } from '@/components/ui/text'
import { useHideMoneyText } from '@/lib/formatters/money-display'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { chartScale, formatAxisMonth, formatCompactMoney, type ResolvedHistoryPoint } from './home-model'

/** Web's `h-44`. */
const HEIGHT = 176
/** Room above and below the plot so the top and bottom tick labels aren't clipped. */
const INSET = themeTokens.spacing[2]
const Y_AXIS_WIDTH = 56

/**
 * Web home's net-worth area (`AreaLineChartBase`, one `area` series): the
 * month-closing values as a chart-1 line over a faint fill, compact money
 * ticks on the left from zero, hairline grid, and the first, middle and last
 * months beneath. The tick and month labels are React Native text beside the
 * Skia canvas, so they use the app's type scale without loading a Skia font.
 */
export function NetWorthChart({ points, currency, locale, accessibilityLabel }: {
  points: readonly ResolvedHistoryPoint[]
  currency: string
  locale: string
  accessibilityLabel: string
}) {
  const palette = usePalette()
  // Privacy mode keeps the line's shape and masks every tick value.
  const hideMoney = useHideMoneyText()
  const scale = chartScale(points.map((point) => point.value))
  const span = scale.max - scale.min || 1
  const plotHeight = HEIGHT - INSET * 2
  const topFor = (value: number) => INSET + (1 - (value - scale.min) / span) * plotHeight
  const data = points.map((point, index) => ({ x: index, value: point.value }))
  const lastIndex = points.length - 1
  const middleIndex = Math.round(lastIndex / 2)
  const xLabels = lastIndex >= 2 ? [0, middleIndex, lastIndex] : [0, lastIndex]

  return (
    <View accessible accessibilityLabel={accessibilityLabel} accessibilityRole="image" testID="net-worth-chart">
      <View style={[styles.row, { height: HEIGHT }]}>
        <View style={styles.yAxis}>
          {scale.ticks.map((tick) => (
            <Text
              key={tick}
              align="right"
              numberOfLines={1}
              style={[styles.tick, { top: topFor(tick) - themeTokens.typography.scale.label.lineHeight / 2 }]}
              tone="muted"
              variant="label"
            >
              {hideMoney(formatCompactMoney(tick, currency, locale), locale, currency)}
            </Text>
          ))}
        </View>
        <View style={styles.plot}>
          {scale.ticks.map((tick) => (
            <View key={tick} style={[styles.grid, { top: topFor(tick), backgroundColor: palette.border }]} />
          ))}
          <View style={styles.canvas}>
            <CartesianChart
              data={data}
              domain={{ y: [scale.min, scale.max] }}
              domainPadding={0}
              padding={0}
              xKey="x"
              yKeys={['value']}
            >
              {({ points: plotted, chartBounds }) => (
                <>
                  <Area
                    color={palette.chart1}
                    curveType="monotoneX"
                    opacity={0.14}
                    points={plotted.value}
                    y0={chartBounds.bottom}
                  />
                  <Line color={palette.chart1} curveType="monotoneX" points={plotted.value} strokeWidth={2} />
                </>
              )}
            </CartesianChart>
          </View>
        </View>
      </View>
      <View style={styles.xAxis}>
        {xLabels.map((index, position) => (
          <Text
            key={index}
            align={position === 0 ? 'left' : position === xLabels.length - 1 ? 'right' : 'center'}
            style={styles.xLabel}
            tone="muted"
            variant="label"
          >
            {formatAxisMonth(points[index].date, locale)}
          </Text>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  yAxis: { width: Y_AXIS_WIDTH, position: 'relative' },
  tick: { position: 'absolute', left: 0, right: themeTokens.spacing[2] },
  plot: { flex: 1, position: 'relative' },
  grid: { position: 'absolute', left: 0, right: 0, height: 1 },
  canvas: { position: 'absolute', left: 0, right: 0, top: INSET, bottom: INSET },
  xAxis: { flexDirection: 'row', justifyContent: 'space-between', marginLeft: Y_AXIS_WIDTH, marginTop: themeTokens.spacing[1] },
  xLabel: { flex: 1 },
})
