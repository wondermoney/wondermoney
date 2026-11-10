import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'
import { Bar, CartesianChart } from 'victory-native'

import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import type { CashflowRow } from './insights-view-model'

/**
 * Web's accounts "Cashflow" bar chart: one bar per month, oldest first, green
 * above zero and red below, on a scale that always includes zero. Month names
 * run under the bars; the container's label stands in for the canvas.
 */
export function CashflowChart({ rows, locale, testID }: { rows: readonly CashflowRow[]; locale: string; testID?: string }) {
  const { t } = useTranslation()
  const palette = usePalette()
  if (rows.length === 0) {
    return <Text style={styles.empty} tone="muted" variant="meta">{t('accountsOverview.emptyTransactions')}</Text>
  }
  const months = [...rows].reverse().map((row, index) => ({
    x: index,
    label: new Intl.DateTimeFormat(locale, { month: 'short' }).format(new Date(row.date)),
    gain: Math.max(0, row.amount),
    loss: Math.min(0, row.amount),
  }))
  const values = rows.map((row) => row.amount)
  const low = Math.min(0, ...values)
  const high = Math.max(0, ...values)
  return (
    <View>
      <View accessible accessibilityLabel={t('accountsOverview.cashflow')} style={styles.chart} testID={testID}>
        <CartesianChart
          data={months}
          domain={{ y: [low, high === low ? low + 1 : high] }}
          domainPadding={{ left: 16, right: 16 }}
          xKey="x"
          yKeys={['gain', 'loss']}
        >
          {({ points, chartBounds }) => (
            <>
              <Bar chartBounds={chartBounds} color={palette.successText} points={points.gain} roundedCorners={{ topLeft: 2, topRight: 2 }} />
              <Bar chartBounds={chartBounds} color={palette.destructive} points={points.loss} roundedCorners={{ bottomLeft: 2, bottomRight: 2 }} />
            </>
          )}
        </CartesianChart>
      </View>
      <View style={styles.axis}>
        {months.map((month) => (
          <Text align="center" key={month.x} numberOfLines={1} style={styles.month} tone="muted" variant="label">{month.label}</Text>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  chart: { height: 200 },
  axis: { flexDirection: 'row', marginTop: themeTokens.spacing[2] },
  month: { flex: 1 },
  empty: { paddingVertical: themeTokens.spacing[6], textAlign: 'center' },
})
