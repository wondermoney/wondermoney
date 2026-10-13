import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'

import { Amount } from '@/components/ui/amount'
import { Text } from '@/components/ui/text'
import { themeTokens, type Palette } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

export function Card({
  children,
  style,
  /** 16px on a data card; 24px for a standalone unit. */
  density = 'data',
  testID,
}: {
  children: React.ReactNode
  style?: StyleProp<ViewStyle>
  density?: 'data' | 'standalone'
  testID?: string
  /** @deprecated read from the colour scheme now; accepted and ignored. */
  palette?: Palette
}) {
  const palette = usePalette()
  return (
    <View
      testID={testID}
      style={[
        styles.card,
        density === 'standalone' ? styles.standalone : styles.data,
        // `card` is the same value as the canvas on purpose — the border is
        // what creates the hierarchy, not a lighter fill.
        { borderColor: palette.border, backgroundColor: palette.card },
        style,
      ]}
    >
      {children}
    </View>
  )
}

export type StatCardProps = {
  label: string
  value: number | null
  currency?: string | null
  locale: string
  /**
   * The like-for-like previous figure, shown adjacent and muted. One glance
   * then gives level *and* direction.
   *
   * Withhold it rather than compare across currencies — that is the dishonest
   * aggregate `DESIGN.md`'s Do's and Don'ts forbid.
   */
  comparison?: { value: number | null; label: string } | null
  /** A signed change. This is the one figure that takes semantic colour. */
  delta?: number | null
  /**
   * Where the useful companion is not a previous period — a target, a count, an
   * as-of time. Also the provenance slot for a single figure.
   */
  helper?: string
  testID?: string
}

/**
 * A headline figure and its comparison.
 *
 * The previous version coloured the *value* by a `tone` prop and painted its
 * `delta` positive-green unconditionally, so a negative change rendered green.
 * Both are gone: the value is always foreground ink, and the delta derives its
 * own direction from its own sign.
 */
export function StatCard({ label, value, currency, locale, comparison, delta, helper, testID }: StatCardProps) {
  return (
    <Card testID={testID}>
      <Text variant="label" tone="muted">
        {label}
      </Text>
      <View style={styles.valueRow}>
        <Amount currency={currency} locale={locale} size="display" value={value} />
        {delta !== null && delta !== undefined ? (
          <Amount currency={currency} delta locale={locale} size="amountSmall" value={delta} />
        ) : null}
      </View>
      {comparison && comparison.value !== null ? (
        <View style={styles.comparison}>
          <Text variant="meta" tone="muted">
            {comparison.label}
          </Text>
          <Amount currency={currency} locale={locale} size="amountSmall" value={comparison.value} />
        </View>
      ) : null}
      {helper ? (
        <Text variant="label" tone="muted">
          {helper}
        </Text>
      ) : null}
    </Card>
  )
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: themeTokens.radius.lg,
    gap: themeTokens.spacing[2],
  },
  data: { padding: themeTokens.spacing[4] },
  standalone: { padding: themeTokens.spacing[6] },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: themeTokens.spacing[2], flexWrap: 'wrap' },
  comparison: { flexDirection: 'row', alignItems: 'baseline', gap: themeTokens.spacing[2], flexWrap: 'wrap' },
})
