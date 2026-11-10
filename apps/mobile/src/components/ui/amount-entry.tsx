import { useRef, useState } from 'react'
import { Pressable, StyleSheet, TextInput, View, type TextInputInstance } from 'react-native'

import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'
import { usePalette } from '@/theme/use-palette'

/**
 * The amount a flow is about, entered big and centred: Geist Mono at the
 * display size, the currency symbol muted on whichever side the locale puts
 * it. Tapping anywhere on the block focuses a decimal keypad.
 *
 * Strings in, strings out, as typed (digits and separators only): the caller
 * parses in the app's language with `@/lib/formatters/decimal-input`
 * ("1.234,56" in pt and es). An empty value shows a muted `0`.
 */
export function AmountEntry({
  value,
  onChangeText,
  currency,
  locale,
  accessibilityLabel,
  caption,
  error,
  editable = true,
  autoFocus = false,
  testID,
}: {
  value: string
  onChangeText: (value: string) => void
  /** ISO code; `null` shows no symbol (no currency chosen yet). */
  currency: string | null
  locale: string
  /** The input's name ("Amount"). */
  accessibilityLabel: string
  /** A muted line under the figure ("Opening balance"). */
  caption?: string
  error?: string | null
  editable?: boolean
  autoFocus?: boolean
  testID?: string
}) {
  const palette = usePalette()
  const ref = useRef<TextInputInstance>(null)
  const [focused, setFocused] = useState(false)
  const symbol = currency ? currencySymbol(currency, locale) : null
  const symbolText = symbol ? (
    <Text accessible={false} style={styles.symbol} tone="muted" variant="display">
      {symbol.text}
    </Text>
  ) : null
  return (
    <View style={styles.block}>
      <Pressable
        accessible={false}
        disabled={!editable}
        onPress={() => ref.current?.focus()}
        style={[styles.figure, focused && { borderColor: palette.ring }, !editable && styles.disabled]}
      >
        {symbol?.before ? symbolText : null}
        <TextInput
          ref={ref}
          accessibilityHint={caption}
          accessibilityLabel={accessibilityLabel}
          accessibilityState={{ disabled: !editable }}
          autoFocus={autoFocus}
          editable={editable}
          keyboardType="decimal-pad"
          maxLength={16}
          onBlur={() => setFocused(false)}
          onChangeText={(text) => onChangeText(text.replace(/[^\d.,]/g, ''))}
          onFocus={() => setFocused(true)}
          placeholder="0"
          placeholderTextColor={palette.mutedForeground}
          selectionColor={palette.primary}
          style={[styles.input, { color: error ? palette.destructiveText : palette.foreground }]}
          testID={testID}
          value={value}
        />
        {symbol && !symbol.before ? symbolText : null}
      </Pressable>
      {caption ? (
        <Text align="center" tone="muted" variant="meta">
          {caption}
        </Text>
      ) : null}
      {error ? (
        <Text accessibilityLiveRegion="polite" accessibilityRole="alert" align="center" tone="destructive" variant="meta">
          {error}
        </Text>
      ) : null}
    </View>
  )
}

/** The locale's symbol for a currency and which side of the number it sits on. */
function currencySymbol(currency: string, locale: string): { text: string; before: boolean } {
  try {
    const formatted = new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(1)
    const digit = formatted.search(/\d/)
    const text = formatted.replace(/[\d.,\s  ]/g, '')
    if (!text) return { text: currency, before: false }
    return { text, before: formatted.indexOf(text) < digit }
  } catch {
    return { text: currency, before: false }
  }
}

const ENTRY_SIZE = 56
const ENTRY_LINE = 64

const styles = StyleSheet.create({
  block: { alignItems: 'center', gap: themeTokens.spacing[1], paddingVertical: themeTokens.spacing[6] },
  figure: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: themeTokens.spacing[2],
    minHeight: ENTRY_LINE + themeTokens.spacing[2],
    paddingHorizontal: themeTokens.spacing[3],
    // A transparent border reserves the focus ring's room, so focus doesn't shift the figure.
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: themeTokens.radius.xl,
    maxWidth: '100%',
  },
  // The amount is what the form is about, so it's set well above the display figure.
  symbol: { flexShrink: 0, fontSize: ENTRY_SIZE, lineHeight: ENTRY_LINE },
  input: { ...textStyles.display, fontSize: ENTRY_SIZE, lineHeight: ENTRY_LINE, padding: 0, minWidth: 40, flexShrink: 1, textAlign: 'center' },
  disabled: { opacity: 0.5 },
})
