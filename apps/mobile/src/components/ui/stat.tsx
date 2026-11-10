import { Children, Fragment, isValidElement } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'

import { Amount } from '@/components/ui/amount'
import { Icon, type IconName } from '@/components/ui/icon'
import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

export type StatProps = {
  /** Sentence case, muted 14px ("Inflow", "Total Gain/Loss"). */
  label: string
  /** Leading glyph at 14pt, muted (web `icon={ArrowDownLeft}` → `arrow-down-left`). */
  icon?: IconName
  /** The money figure; `null` renders `—`. Ignored when `valueNode` is set. */
  value?: number | null
  currency?: string | null
  locale: string
  /** Signs a money value (`+€2,668.01`); web passes `signed` on gain/loss stats. */
  signed?: boolean
  /** For a figure that is not money — a count, a percentage — already formatted. Render it with `<StatValue>`. */
  valueNode?: React.ReactNode
  /** Same measure last period, muted mono 12px beside the value, then `label` ("vs last period"). */
  comparison?: { value: number | null; label: string } | null
  /** Signed proportion (0.12 = 12%), shown top-right with a trend icon. 0/null hides it. */
  deltaPercent?: number | null
  /**
   * A direction without a percentage: the trend icon alone, top-right (web
   * PortfolioDashboardSummary's gains rows). Ignored when `deltaPercent` shows.
   */
  trend?: 'up' | 'down' | null
  /** Which way is good: `down` for outflow, where a fall is an improvement. Default `up`. */
  positiveDirection?: 'up' | 'down'
  /** Muted text top-right when there is no delta ("2 Portfolios"). */
  aside?: string
  /** Muted 12px line under the value — provenance, definition, unit. */
  helper?: React.ReactNode
  testID?: string
}

/**
 * One cell of a ruled stat list — web's `StatCard` (`components/ui/StatCard.tsx`)
 * at phone width: label row (icon + label left, delta right), then the value in
 * 24pt Geist Mono, a muted comparison beside it, a helper under it. No box:
 * `StatList` draws the hairlines between cells.
 */
export function Stat({
  label,
  icon,
  value,
  currency,
  locale,
  signed = false,
  valueNode,
  comparison,
  deltaPercent,
  trend = null,
  positiveDirection = 'up',
  aside,
  helper,
  testID,
}: StatProps) {
  const palette = usePalette()
  const hasDelta = deltaPercent !== null && deltaPercent !== undefined && Number.isFinite(deltaPercent) && deltaPercent !== 0
  const rose = hasDelta ? (deltaPercent as number) > 0 : trend === 'up'
  const good = positiveDirection === 'up' ? rose : !rose
  const deltaTone = good ? 'success' : 'destructive'
  const deltaColor = good ? palette.successText : palette.destructiveText

  return (
    <View style={styles.cell} testID={testID}>
      <View style={styles.labelRow}>
        <View style={styles.labelGroup}>
          {icon ? <Icon color={palette.mutedForeground} name={icon} size={14} /> : null}
          <Text numberOfLines={1} style={styles.shrink} tone="muted" variant="meta">
            {label}
          </Text>
        </View>
        {hasDelta ? (
          <View style={styles.delta}>
            <Icon color={deltaColor} name={rose ? 'trending-up' : 'trending-down'} size={12} />
            <Text style={styles.deltaText} tone={deltaTone} variant="label">
              {formatPercent(Math.abs(deltaPercent as number), locale)}
            </Text>
          </View>
        ) : trend ? (
          <Icon color={deltaColor} name={rose ? 'trending-up' : 'trending-down'} size={16} />
        ) : aside ? (
          <Text tone="muted" variant="meta">
            {aside}
          </Text>
        ) : null}
      </View>
      <View style={styles.valueRow}>
        {valueNode ?? <SignedAmount currency={currency} locale={locale} signed={signed} value={value} />}
        {comparison && comparison.value !== null ? (
          <View style={styles.comparison}>
            <Amount currency={currency} locale={locale} size="amountSmall" value={comparison.value} />
            <Text tone="muted" variant="label">
              {comparison.label}
            </Text>
          </View>
        ) : null}
      </View>
      {helper ? (
        typeof helper === 'string' ? (
          <Text tone="muted" variant="label">
            {helper}
          </Text>
        ) : (
          helper
        )
      ) : null}
    </View>
  )
}

/**
 * A non-money stat value ("95", "+17.06%") in the stat's 24pt Geist Mono, or
 * 18pt (`size="amountLarge"`) where web drops to `text-lg` (portfolio metrics).
 */
export function StatValue({ children, tone = 'default', size = 'stat' }: { children: string; tone?: 'default' | 'muted' | 'warning'; size?: 'stat' | 'amountLarge' }) {
  return (
    <Text tone={tone} variant={size}>
      {children}
    </Text>
  )
}

function SignedAmount({ value, currency, locale, signed }: { value: number | null | undefined; currency?: string | null; locale: string; signed: boolean }) {
  // `Amount`'s `delta` both signs and colours; a level stat (gain/loss shown as
  // a level, web `tone="level" signed`) wants the sign only.
  if (signed && value !== null && value !== undefined && value > 0) {
    return (
      <View style={styles.signed}>
        <Text variant="stat">+</Text>
        <Amount currency={currency} locale={locale} size="stat" value={value} />
      </View>
    )
  }
  return <Amount currency={currency} locale={locale} size="stat" value={value} />
}

/**
 * The ruled stat list — web's `StatCardGrid` at phone width (`divide-y`): cells
 * stacked with a hairline between them and none around them. Pass `Stat`s.
 *
 * @param columns  2 lays cells out in a two-column grid with no rules (web's
 *                 transactions summary: "Transactions in view | Money in").
 */
export function StatList({
  children,
  columns = 1,
  style,
  testID,
}: {
  children: React.ReactNode
  columns?: 1 | 2
  style?: StyleProp<ViewStyle>
  testID?: string
}) {
  const palette = usePalette()
  const items = Children.toArray(children).filter(isValidElement)

  if (columns === 2) {
    return (
      <View style={[styles.grid, style]} testID={testID}>
        {items.map((child, index) => (
          <View key={index} style={styles.gridCell}>
            {child}
          </View>
        ))}
      </View>
    )
  }

  return (
    <View style={style} testID={testID}>
      {items.map((child, index) => (
        <Fragment key={index}>
          {index > 0 ? <View style={[styles.rule, { backgroundColor: palette.border }]} /> : null}
          {child}
        </Fragment>
      ))}
    </View>
  )
}

/**
 * A secondary figure under a `HeadlineFigure`: a muted label (it may wrap,
 * never truncates) over the value at the `amountBase` size, on one line,
 * shrinking to fit its column rather than wrapping. Pass a money
 * value with `value`/`currency`, or a formatted count as `children`.
 */
export function StatCell({ label, value, currency, locale, children, testID }: {
  label: string
  value?: number | null
  currency?: string | null
  locale: string
  /** A non-money value ("5", "67%"); rendered at `amountBase`. */
  children?: string
  testID?: string
}) {
  return (
    <View style={styles.columnCell} testID={testID}>
      <Text tone="muted" variant="meta">{label}</Text>
      {/* The value never wraps: it stays on one line and shrinks to fit its column. */}
      {children !== undefined
        ? <Text adjustsFontSizeToFit minimumFontScale={0.6} numberOfLines={1} variant="amountBase">{children}</Text>
        : <Amount currency={currency} fit locale={locale} size="amountBase" value={value ?? null} />}
    </View>
  )
}

/**
 * The secondary stats under a page's one headline figure: one row of 2–3
 * equal columns, or a 2×2 grid for four. No rules, no boxes. Pass `StatCell`s.
 */
export function StatColumns({ children, style, testID }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const items = Children.toArray(children).filter(isValidElement)
  const grid = items.length > 3
  return (
    <View style={[styles.columns, style]} testID={testID}>
      {items.map((child, index) => (
        <View key={child.key ?? index} style={grid ? styles.columnHalf : styles.columnEqual}>
          {child}
        </View>
      ))}
    </View>
  )
}

function formatPercent(value: number, locale: string) {
  try {
    return new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value)
  } catch {
    return `${Math.round(value * 100)}%`
  }
}

const styles = StyleSheet.create({
  cell: { paddingVertical: themeTokens.spacing[3], gap: themeTokens.spacing[2] },
  columns: { flexDirection: 'row', flexWrap: 'wrap', columnGap: themeTokens.spacing[4], rowGap: themeTokens.spacing[4] },
  columnEqual: { flex: 1, minWidth: 0 },
  // Two per row: half the width less half the column gap.
  columnHalf: { width: '47%', minWidth: 0 },
  columnCell: { gap: 2 },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[2] },
  labelGroup: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2], flexShrink: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  delta: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[1], flexShrink: 0 },
  deltaText: { fontWeight: '500' },
  valueRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: themeTokens.spacing[2], rowGap: 2 },
  comparison: { flexDirection: 'row', alignItems: 'baseline', gap: themeTokens.spacing[1] },
  signed: { flexDirection: 'row', alignItems: 'baseline' },
  rule: { height: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: themeTokens.spacing[2], columnGap: themeTokens.spacing[4] },
  gridCell: { flexBasis: '45%', flexGrow: 1 },
})
