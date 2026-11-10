import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'
import { Area, CartesianChart, Line } from 'victory-native'

import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import type { BalancePoint } from './balance-growth'

/**
 * Web's "Balance growth" area chart (chart slot 1). The canvas has no
 * screen-reader content, so the container carries the section name and the
 * date range sits under it as text.
 */
export function BalanceGrowthChart({ points, locale, testID }: { points: readonly BalancePoint[]; locale: string; testID?: string }) {
  const { t } = useTranslation()
  const palette = usePalette()
  if (points.length < 2) {
    return <Text style={styles.empty} tone="muted" variant="meta">{t('accountsOverview.emptyTransactions')}</Text>
  }
  const date = (time: number) => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date(time))
  return (
    <View>
      <View accessible accessibilityLabel={t('accountsOverview.balanceGrowth')} style={styles.chart} testID={testID}>
        <CartesianChart data={points.map((point) => ({ ...point }))} domainPadding={{ top: 8, bottom: 8 }} xKey="x" yKeys={['balance']}>
          {({ points: series, chartBounds }) => (
            <>
              <Area color={palette.primarySoft} points={series.balance} y0={chartBounds.bottom} />
              <Line color={palette.chart1} points={series.balance} strokeWidth={2} />
            </>
          )}
        </CartesianChart>
      </View>
      <View style={styles.axis}>
        <Text tone="muted" variant="amountSmall">{date(points[0]!.x)}</Text>
        <Text tone="muted" variant="amountSmall">{date(points[points.length - 1]!.x)}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  chart: { height: 200 },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: themeTokens.spacing[2] },
  empty: { paddingVertical: themeTokens.spacing[6], textAlign: 'center' },
})
