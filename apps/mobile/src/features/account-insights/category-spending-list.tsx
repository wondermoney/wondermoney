import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { Amount } from '@/components/ui/amount'
import { Text } from '@/components/ui/text'
import { UnconvertedAmountsNote } from '@/components/ui/unconverted-amounts-note'
import type { AmountsCompleteness } from '@/lib/api/completeness'
import { formatCategoryName } from '@/lib/formatters/category-name'
import { themeTokens, type Palette } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import type { CategoryRow } from './insights-view-model'

/** Chart slots 1–5 in order; a sixth series never cycles a colour (DESIGN.md), it goes muted. */
export const chartSlot = (palette: Palette, index: number) =>
  [palette.chart1, palette.chart2, palette.chart3, palette.chart4, palette.chart5][index] ?? palette.mutedForeground

/**
 * Web's accounts "Spending by category": each category's name and amount, a
 * thin share bar under it and the percentage at its end, hairlines between.
 */
export function CategorySpendingList({ rows, currency, locale, completeness }: { rows: readonly CategoryRow[]; currency: string; locale: string; completeness?: AmountsCompleteness }) {
  const { t } = useTranslation()
  const palette = usePalette()
  const note = <UnconvertedAmountsNote completeness={completeness} testID="category-spending-unconverted" />
  if (rows.length === 0) {
    return (
      <View>
        <Text style={styles.empty} tone="muted" variant="meta">{t('accountsOverview.emptyCategorySpending')}</Text>
        {note}
      </View>
    )
  }
  const total = rows.reduce((sum, row) => sum + Math.abs(row.amount), 0)
  return (
    <View>
      {rows.map((row, index) => {
        const share = total > 0 ? Math.abs(row.amount) / total : 0
        const name = formatCategoryName(row.name)
        const percent = formatShare(share, locale)
        return (
          <View
            accessible
            accessibilityLabel={`${name}, ${percent}`}
            key={`${row.id}-${index}`}
            style={[styles.row, index > 0 && { borderTopWidth: 1, borderTopColor: palette.border }, index === 0 && styles.first]}
          >
            <View style={styles.line}>
              <Text numberOfLines={1} style={styles.name} variant="meta">{name}</Text>
              <Amount currency={row.currency ?? currency} locale={locale} value={Math.abs(row.amount)} />
            </View>
            <View style={styles.line}>
              <View style={[styles.track, { backgroundColor: palette.muted }]}>
                <View style={[styles.fill, { width: `${share * 100}%`, backgroundColor: chartSlot(palette, index) }]} />
              </View>
              <Text align="right" style={styles.percent} tone="muted" variant="amountSmall">{percent}</Text>
            </View>
          </View>
        )
      })}
      {note}
    </View>
  )
}

function formatShare(value: number, locale: string) {
  try {
    return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(value)
  } catch {
    return `${Math.round(value * 100)}%`
  }
}

const styles = StyleSheet.create({
  empty: { paddingVertical: themeTokens.spacing[6], textAlign: 'center' },
  row: { paddingVertical: themeTokens.spacing[3], gap: 6 },
  first: { paddingTop: 0 },
  line: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2] },
  name: { flex: 1 },
  track: { flex: 1, height: 6, borderRadius: themeTokens.radius.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: themeTokens.radius.pill },
  percent: { width: 40 },
})
