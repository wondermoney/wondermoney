import { useTranslation } from 'react-i18next'
import { StyleSheet, View, type TextStyle } from 'react-native'

import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

/** The em-dash that stands for an absence. Never `0`, never blank. */
export const MISSING = '—'

export type AmountProps = {
  /** `null` renders `—`. Do not pass `?? 0`; a zero is a measurement. */
  value: number | null | undefined
  currency?: string | null
  locale: string
  size?: 'display' | 'amount' | 'amountSmall'
  /**
   * A balance is never coloured by its sign — the minus sign carries that
   * (`DESIGN.md`'s Do's and Don'ts). Set `delta` only on a figure that genuinely *is*
   * a change, where direction is the point.
   */
  delta?: boolean
  align?: TextStyle['textAlign']
  /** Overrides the accessible reading. Defaults to the full formatted string. */
  accessibilityLabel?: string
  testID?: string
}

/**
 * A money figure, split from its currency.
 *
 * `Intl.NumberFormat` with `style: "currency"` returns `€11,250.00` as one
 * atomic string with no seam to style, so the eye has to re-read a token that
 * is identical on every row. `formatToParts` gives the seam back: the amount
 * stays in foreground ink and the currency sits beside it in muted ink.
 *
 * Position is not hardcoded — the symbol prefixes in `en` and suffixes in
 * `pt`/`es`, and this reads whichever the locale produced rather than assuming.
 */
export function Amount({
  value,
  currency,
  locale,
  size = 'amount',
  delta = false,
  align,
  accessibilityLabel,
  testID,
}: AmountProps) {
  const { t } = useTranslation()
  const palette = usePalette()

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

  const parts = formatParts(value, locale, currency, delta)
  const plain = parts.map((part) => part.value).join('')

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
      >
        {parts.map((part, index) =>
          part.kind === 'currency' ? (
            <Text key={index} variant={size} style={{ color: palette.mutedForeground }}>
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

type Part = { kind: 'currency' | 'value'; value: string }

function formatParts(value: number, locale: string, currency: string | null | undefined, signed: boolean): Part[] {
  const options: Intl.NumberFormatOptions = currency
    ? { style: 'currency', currency, signDisplay: signed ? 'exceptZero' : 'auto' }
    : { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: signed ? 'exceptZero' : 'auto' }

  try {
    return new Intl.NumberFormat(locale, options)
      .formatToParts(value)
      .map<Part>((part) => ({
        // `currency` is the symbol or code; `literal` is the space beside it,
        // which belongs to the muted half so the gap doesn't jump when the
        // currency changes.
        kind: part.type === 'currency' ? 'currency' : 'value',
        value: part.value,
      }))
      .reduce<Part[]>((acc, part) => {
        const previous = acc[acc.length - 1]
        if (previous && previous.kind === part.kind) {
          previous.value += part.value
          return acc
        }
        acc.push({ ...part })
        return acc
      }, [])
  } catch {
    // An unknown or malformed currency code must not take the screen down with
    // it — render the number and let the code sit beside it as plain text.
    const number = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      signDisplay: signed ? 'exceptZero' : 'auto',
    }).format(value)
    return currency ? [{ kind: 'value', value: `${number} ` }, { kind: 'currency', value: currency }] : [{ kind: 'value', value: number }]
  }
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
})
