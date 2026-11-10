import { StyleSheet, View } from 'react-native'

import { Amount } from '@/components/ui/amount'
import { Icon } from '@/components/ui/icon'
import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

export type HeadlineFigureProps = {
  /** Names the figure ("Total balance", "Net worth", "Account balance"). */
  label?: string
  /** `lead` (default): 16/500 foreground, as on home and accounts. `muted`: 14 muted, as on an object header. */
  labelTone?: 'lead' | 'muted'
  /** Right-aligned muted text on the label row (home's "Balances updated 1 day ago"). */
  labelAside?: string
  /**
   * The status line's word, inline after the label behind a dot: "Net worth
   * · Balances updated 2 days ago", "Allocated · Starting". The dot takes the
   * tone (`muted` by default; `warning` for a stale source, `success` for a
   * goal on track); the words stay muted so colour never carries them alone.
   */
  status?: { label: string; tone?: 'muted' | 'success' | 'warning' | 'destructive' }
  /** Gives the label the header role, when it names the page's lead block. */
  labelIsHeader?: boolean
  value: number | null
  currency?: string | null
  locale: string
  /** `lg` 48pt (page lead, web `text-5xl`), `md` 36pt (object header, web `text-4xl`). */
  size?: 'lg' | 'md'
  /**
   * Signed changes under the figure, each a semantic-coloured mono amount and
   * a muted label ("vs last period", "since the end of October"). `trend`
   * adds web's TrendingUp/Down glyph before it.
   */
  deltas?: { value: number | null; label: string; trend?: boolean }[]
  /** A second figure in another currency, muted beside the first (web ObjectHeader `secondaryValue`). */
  secondary?: { value: number | null; currency?: string | null } | null
  /**
   * Sets the cents smaller on the figure's baseline (€136,530 then ".67" at
   * about 55%). On by default: every lead figure reads by its whole units.
   */
  splitCents?: boolean
  /** The change lines' figure size: `amount` 14 (default, web `text-sm`) or `amountBase` 16 (home, web `text-base`). */
  deltaSize?: 'amount' | 'amountBase'
  /**
   * Makes the figure and its changes one accessible element with this reading
   * (figure, currency and changes), so the colour of a delta never carries its
   * sign alone. The label row stays a separate element.
   */
  accessibilityLabel?: string
  /** Provenance or a caveat under it: pass a `<Text variant="label">` or a provenance component. */
  footer?: React.ReactNode
  testID?: string
}

/**
 * The page's lead figure: web's accounts "Total balance €289,923.86", home's
 * NetWorthHero, ObjectHeader's value. Geist Mono 500, tight tracking, currency
 * symbol muted (via `Amount`); an absent value is `—`, never `0`.
 */
export function HeadlineFigure({
  label,
  labelTone = 'lead',
  labelAside,
  status,
  labelIsHeader = false,
  splitCents = true,
  value,
  currency,
  locale,
  size = 'lg',
  deltas,
  deltaSize = 'amount',
  accessibilityLabel,
  secondary,
  footer,
  testID,
}: HeadlineFigureProps) {
  const palette = usePalette()
  const statusInk = {
    muted: palette.mutedForeground,
    success: palette.successText,
    warning: palette.warningText,
    destructive: palette.destructiveText,
  }[status?.tone ?? 'muted']
  const labelRow = label || labelAside || status ? (
    <View style={styles.labelRow}>
      <View style={styles.labelGroup}>
        {label ? (
          <Text
            accessibilityRole={labelIsHeader ? 'header' : undefined}
            style={styles.shrink}
            tone={labelTone === 'lead' ? 'default' : 'muted'}
            variant={labelTone === 'lead' ? 'subheading' : 'meta'}
          >
            {label}
          </Text>
        ) : null}
        {status ? (
          <View style={styles.status}>
            <View accessible={false} style={[styles.dot, { backgroundColor: statusInk }]} />
            <Text style={styles.shrink} tone="muted" variant="meta">
              {status.label}
            </Text>
          </View>
        ) : null}
      </View>
      {labelAside ? (
        <Text tone="muted" variant="label">
          {labelAside}
        </Text>
      ) : null}
    </View>
  ) : null
  // The label row stays its own element (a header a screen reader can jump
  // to); the figure and its changes read as one.
  return (
    <View style={styles.block} testID={testID}>
      {labelRow}
      <View accessibilityLabel={accessibilityLabel} accessible={accessibilityLabel ? true : undefined} style={styles.figureGroup}>
        <View style={styles.figureRow}>
          <Amount currency={currency} locale={locale} size={size === 'lg' ? 'display' : 'figure'} split={splitCents} value={value} />
          {secondary && secondary.value !== null ? (
            <Amount currency={secondary.currency} locale={locale} size="amount" value={secondary.value} />
          ) : null}
        </View>
        {(deltas ?? [])
          .filter((delta) => delta.value !== null && delta.value !== 0)
          .map((delta, index) => {
            const up = (delta.value as number) > 0
            return (
              <View key={index} style={styles.deltaRow}>
                {delta.trend ? (
                  <Icon color={up ? palette.successText : palette.destructiveText} name={up ? 'trending-up' : 'trending-down'} size={14} />
                ) : null}
                <Amount currency={currency} delta locale={locale} size={deltaSize} value={delta.value} />
                <Text tone="muted" variant={delta.trend ? 'label' : 'meta'}>
                  {delta.label}
                </Text>
              </View>
            )
          })}
      </View>
      {footer}
    </View>
  )
}

const styles = StyleSheet.create({
  block: { gap: themeTokens.spacing[1] },
  labelRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: themeTokens.spacing[3] },
  labelGroup: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: themeTokens.spacing[2], rowGap: 2, flexShrink: 1 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  figureGroup: { gap: themeTokens.spacing[1] },
  shrink: { flexShrink: 1 },
  figureRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: themeTokens.spacing[3] },
  deltaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: themeTokens.spacing[1] },
})
