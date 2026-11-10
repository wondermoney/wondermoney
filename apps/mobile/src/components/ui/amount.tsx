import { useTranslation } from 'react-i18next'
import { StyleSheet, View, type TextStyle } from 'react-native'

import { Text } from '@/components/ui/text'
import { maskMoney } from '@/lib/formatters/money-display'
import { usePrivacyMode } from '@/lib/privacy/privacy-mode'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

/** The em-dash that stands for an absence. Never `0`, never blank. */
export const MISSING = '—'

export type AmountProps = {
  /** `null` renders `—`. Do not pass `?? 0`; a zero is a measurement. */
  value: number | null | undefined
  currency?: string | null
  locale: string
  /**
   * A mono role from the scale: `display` 48 (page lead), `figure` 36 (object
   * header), `stat` 24 (stat cell), `amount` 14 (row), `amountSmall` 12.
   */
  size?: 'display' | 'figure' | 'stat' | 'amountLarge' | 'amountBase' | 'amount' | 'amountSmall'
  /**
   * A balance is never coloured by its sign — the minus sign carries that
   * (`DESIGN.md`'s Do's and Don'ts). Set `delta` only on a figure that genuinely *is*
   * a change, where direction is the point.
   */
  delta?: boolean
  align?: TextStyle['textAlign']
  /**
   * Sets the fraction (".67") smaller on the same baseline, about 55% of the
   * figure: the whole units carry the reading, the cents stay legible. Meant
   * for lead figures (`HeadlineFigure` turns it on); a row amount stays whole.
   */
  split?: boolean
  /**
   * Keeps the figure on one line, shrinking the font (to 60% at most) when its
   * column is too narrow. For a figure in a fixed-width cell (`StatCell`).
   */
  fit?: boolean
  /**
   * Overrides the accessible reading. Defaults to the full formatted string.
   * Ignored while privacy mode is on: the reading is then "Hidden amount".
   */
  accessibilityLabel?: string
  testID?: string
}

/**
 * A money figure, split from its currency.
 *
 * `Intl.NumberFormat` with `style: "currency"` returns `€11,250.00` as one
 * atomic string with no seam to style, so the eye has to re-read a token that
 * is identical on every row. `formatParts` gives the seam back: the amount
 * stays in foreground ink and the currency sits beside it in muted ink.
 *
 * Position is not hardcoded — the symbol prefixes in `en` and suffixes in
 * `pt`/`es`, and this reads whichever the locale produced rather than assuming.
 *
 * In privacy mode the figure is replaced by a fixed mask (`€•••••`): the value
 * is neither rendered nor in the accessibility label, and a delta loses its
 * colour, since the colour alone would say which way it moved.
 */
export function Amount({
  value,
  currency,
  locale,
  size = 'amount',
  delta = false,
  align,
  split = false,
  fit = false,
  accessibilityLabel,
  testID,
}: AmountProps) {
  const { t } = useTranslation()
  const palette = usePalette()
  const { hidden } = usePrivacyMode()
  const fitting = fit ? { numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: FIT_MIN_SCALE, style: styles.fit } : null

  if (value === null || value === undefined || !Number.isFinite(value)) {
    return (
      <Text
        variant={size}
        tone="muted"
        align={align}
        accessibilityLabel={accessibilityLabel ?? t('common.unavailable', { defaultValue: 'Not available' })}
        testID={testID}
      >
        {MISSING}
      </Text>
    )
  }

  if (hidden) {
    const mask = maskMoney(locale, currency)
    return (
      <View style={[styles.row, align === 'right' ? styles.right : null]} testID={testID}>
        <Text variant={size} tone="default" accessibilityLabel={t('privacy.hiddenAmount')} {...fitting}>
          {mask.split(/(•+)/).filter(Boolean).map((run, index) =>
            run.startsWith('•') ? run : (
              <Text key={index} variant={size} style={{ color: palette.mutedForeground }}>
                {run}
              </Text>
            ),
          )}
        </Text>
      </View>
    )
  }

  const parts = formatParts(value, locale, currency, delta)
  const plain = parts.map((part) => part.value).join('')
  const scale = themeTokens.typography.scale[size]
  // The fraction keeps the figure's line height, so the smaller run sits on
  // the same baseline instead of pulling the line shorter.
  const fractionStyle = { fontSize: Math.round(scale.fontSize * SPLIT_RATIO), lineHeight: scale.lineHeight, letterSpacing: 0 }
  const rendered = split ? splitFraction(parts, locale) : parts

  // A delta is the one figure where direction *is* the content, so it takes
  // semantic ink — and it takes an explicit sign alongside it, because colour
  // never acts alone.
  const tone = delta ? (value > 0 ? 'success' : value < 0 ? 'destructive' : 'muted') : 'default'

  return (
    <View style={[styles.row, align === 'right' ? styles.right : null]} testID={testID}>
      <Text
        variant={size}
        tone={tone}
        accessibilityLabel={accessibilityLabel ?? plain}
        {...fitting}
      >
        {rendered.map((part, index) =>
          part.kind === 'currency' ? (
            <Text key={index} variant={size} style={{ color: palette.mutedForeground }}>
              {part.value}
            </Text>
          ) : part.kind === 'fraction' ? (
            <Text key={index} variant={size} tone={tone} style={fractionStyle}>
              {part.value}
            </Text>
          ) : (
            part.value
          ),
        )}
      </Text>
    </View>
  )
}

/** How far `fit` may shrink a figure before it would rather be clipped. */
const FIT_MIN_SCALE = 0.6

type Part = { kind: 'currency' | 'value'; value: string }
type RenderedPart = { kind: 'currency' | 'value' | 'fraction'; value: string }

/** The fraction's size against the whole units (48 → 26, 36 → 20). */
const SPLIT_RATIO = 0.55

/**
 * Cuts the decimal separator and the digits after it out of the last number
 * run, so it can be set smaller. The separator is read from the locale
 * (`.` in en, `,` in pt and es) rather than assumed; a figure without a
 * fraction (JPY) is returned as it was.
 */
function splitFraction(parts: readonly Part[], locale: string): RenderedPart[] {
  const separator = decimalSeparator(locale)
  const index = parts.map((part) => part.kind).lastIndexOf('value')
  if (index < 0) return [...parts]
  const run = parts[index].value
  const at = run.lastIndexOf(separator)
  if (at < 0 || !/^\d+$/.test(run.slice(at + 1))) return [...parts]
  return [
    ...parts.slice(0, index),
    { kind: 'value', value: run.slice(0, at) },
    { kind: 'fraction', value: run.slice(at) },
    ...parts.slice(index + 1),
  ]
}

function decimalSeparator(locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { minimumFractionDigits: 1 }).format(1.5).replace(/\d/g, '') || '.'
  } catch {
    return '.'
  }
}

/**
 * Splits the figure from its currency without `formatToParts` or `signDisplay`:
 * Hermes doesn't implement either on every React Native runtime, and a throw
 * here used to drop every amount into the fallback ("265,000.00 EUR") on
 * device while Jest, on Node, rendered "€265,000.00". It formats the magnitude
 * the way `formatCurrency` does, finds the bare number inside that string, and
 * marks what surrounds it as the currency. The sign is written in front, which
 * is where `Intl` puts it for every locale the app ships (en, pt-PT, es).
 */
function formatParts(value: number, locale: string, currency: string | null | undefined, signed: boolean): Part[] {
  const sign = value < 0 ? '-' : signed && value > 0 ? '+' : ''
  const magnitude = Math.abs(value)

  if (!currency) {
    return [{ kind: 'value', value: `${sign}${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(magnitude)}` }]
  }

  try {
    const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency })
    const full = formatter.format(magnitude)
    const number = new Intl.NumberFormat(locale, fractionDigitsOf(formatter)).format(magnitude)
    const at = full.indexOf(number)
    if (at < 0) return [{ kind: 'value', value: `${sign}${full}` }]
    // The space beside the symbol belongs to the muted half, so the gap doesn't
    // jump when the currency changes.
    return mergeParts([
      { kind: 'value', value: sign },
      { kind: 'currency', value: full.slice(0, at) },
      { kind: 'value', value: number },
      { kind: 'currency', value: full.slice(at + number.length) },
    ])
  } catch {
    // An unknown or malformed currency code must not take the screen down with
    // it — render the number and let the code sit beside it as plain text.
    const number = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(magnitude)
    return [{ kind: 'value', value: `${sign}${number} ` }, { kind: 'currency', value: currency }]
  }
}

function fractionDigitsOf(formatter: Intl.NumberFormat): Intl.NumberFormatOptions {
  try {
    const { minimumFractionDigits, maximumFractionDigits } = formatter.resolvedOptions()
    return { minimumFractionDigits, maximumFractionDigits }
  } catch {
    return { minimumFractionDigits: 2, maximumFractionDigits: 2 }
  }
}

function mergeParts(parts: Part[]): Part[] {
  return parts.reduce<Part[]>((acc, part) => {
    if (!part.value) return acc
    const previous = acc[acc.length - 1]
    if (previous && previous.kind === part.kind) {
      previous.value += part.value
      return acc
    }
    acc.push({ ...part })
    return acc
  }, [])
}

/**
 * An aggregate that cannot be computed honestly (`DESIGN.md`'s Do's and Don'ts).
 * Two currencies do not sum; render what the thing actually is.
 */
export function MixedAmount({ currencyCount, size = 'amount' }: { currencyCount: number; size?: AmountProps['size'] }) {
  const { t } = useTranslation()
  return (
    <Text variant={size} tone="muted">
      {t('common.mixedCurrencies', { count: currencyCount, defaultValue: '{{count}} currencies' })}
    </Text>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'baseline', gap: themeTokens.spacing[1] },
  right: { justifyContent: 'flex-end' },
  fit: { flexShrink: 1, minWidth: 0 },
})
