import { createElement, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Platform, Pressable, StyleSheet, TextInput, useColorScheme, View } from 'react-native'
import { SymbolView } from 'expo-symbols'
import type { DateTimePickerProps } from '@expo/ui/community/datetime-picker'

import { Icon } from '@/components/ui/icon'
import { Text } from '@/components/ui/text'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'
import { usePalette } from '@/theme/use-palette'

export type DateFieldProps = {
  label: string
  /** An ISO calendar date, `YYYY-MM-DD`, or `null` when unset. */
  value: string | null
  /** Receives an ISO calendar date (`YYYY-MM-DD`), or `null` when cleared. */
  onChange: (value: string | null) => void
  /** Earliest selectable day, `YYYY-MM-DD`. */
  minimumDate?: string
  /** Latest selectable day, `YYYY-MM-DD`. */
  maximumDate?: string
  /** Adds a clear action that hands `null` back. */
  optional?: boolean
  error?: string
  helperText?: string
  testID?: string
  disabled?: boolean
  /**
   * `field` (default): the label above a 40pt box. `row`: a 56pt form row,
   * the label left and the date right, for a `FormGroup` (calm-structure flows).
   */
  appearance?: 'field' | 'row'
  /** Overrides the shown date ("Today"). The value handed back is unchanged. */
  formatValue?: (date: Date) => string | null
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Reads `YYYY-MM-DD` as a *local* calendar day.
 *
 * `new Date('2026-03-01')` parses as UTC midnight, which west of Greenwich is
 * the evening of February 28th — the day a person picked would render, and be
 * sent back, as the day before. Building the date from its parts keeps it on
 * the calendar day the string names.
 */
export function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const match = ISO_DATE.exec(value.trim())
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(year, month - 1, day)
  // Rejects 2026-02-30 and friends, which Date would roll into March.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return date
}

/** Writes a Date's local calendar day as `YYYY-MM-DD`, never via `toISOString()` (UTC). */
export function formatIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function formatForDisplay(date: Date, language: string): string {
  try {
    return new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
  } catch {
    return formatIsoDate(date)
  }
}

function clamp(date: Date, min: Date | null, max: Date | null): Date {
  if (min && date < min) return min
  if (max && date > max) return max
  return date
}

function today(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

/**
 * The fallback hands back whatever was typed (trimmed), so a caller's own
 * validation still sees partial input exactly as it did with a text field.
 *
 * The native picker only exists on iOS and Android builds. Jest (`NODE_ENV`
 * is `test`) and web get the text fallback instead, which also keeps screen
 * tests able to `changeText` a date the way they did before this field existed.
 */
const usesNativePicker = (Platform.OS === 'ios' || Platform.OS === 'android') && process.env.NODE_ENV !== 'test'

type PickerComponent = (props: DateTimePickerProps) => React.ReactElement | null
let NativePicker: PickerComponent | null = null
function loadNativePicker(): PickerComponent {
  // Required lazily so the native views are only resolved on a platform that has them.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  NativePicker ??= (require('@expo/ui/community/datetime-picker') as { DateTimePicker: PickerComponent }).DateTimePicker
  return NativePicker
}

/** Declared once at module scope so the lazily required picker has a stable component identity. */
function NativeDatePicker(props: DateTimePickerProps) {
  return createElement(loadNativePicker(), props)
}

/**
 * The one date input. Strings in, strings out: callers keep a `YYYY-MM-DD`
 * (or `null`) in state exactly as they did when this was a typed text field.
 *
 * iOS opens SwiftUI's graphical calendar inline under the field; Android opens
 * the Material 3 date dialog. Both are reached through `@expo/ui`'s
 * datetime-picker layer, which already converts Material's UTC days to local
 * ones.
 */
export function DateField({ label, value, onChange, minimumDate, maximumDate, optional = false, error, helperText, testID, disabled = false, appearance = 'field', formatValue }: DateFieldProps) {
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light'
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const [draft, setDraft] = useState<Date | null>(null)

  const selected = parseIsoDate(value)
  const min = parseIsoDate(minimumDate)
  const max = parseIsoDate(maximumDate)
  const active = open || focused
  const borderColor = error ? palette.destructiveText : active ? palette.ring : palette.input
  const boxStyle = [styles.box, { borderColor, backgroundColor: palette.card }, (error || active) && styles.boxEmphasis, disabled && styles.disabled]

  const footer = error ? (
    <Text accessibilityLiveRegion="polite" tone="destructive" variant="meta">
      {error}
    </Text>
  ) : helperText ? (
    <Text tone="muted" variant="meta">
      {helperText}
    </Text>
  ) : null

  const clear =
    optional && value && !disabled ? (
      <ClearButton
        label={t('common.clearDate')}
        onPress={() => {
          setOpen(false)
          onChange(null)
        }}
        palette={palette}
      />
    ) : null

  const row = appearance === 'row'
  const rowStyle = [styles.row, active && [styles.rowFocused, { borderColor: palette.ring }], disabled && styles.disabled]
  const rowFooter = error ? (
    <Text accessibilityLiveRegion="polite" style={styles.rowNote} tone="destructive" variant="meta">
      {error}
    </Text>
  ) : helperText ? (
    <Text style={styles.rowNote} tone="muted" variant="meta">
      {helperText}
    </Text>
  ) : null

  if (!usesNativePicker && row) {
    return (
      <View testID={testID}>
        <View style={rowStyle}>
          <Text style={styles.rowLabel} tone={error ? 'destructive' : 'default'} variant="body">
            {label}
          </Text>
          <TextInput
            accessibilityHint={helperText}
            accessibilityLabel={label}
            accessibilityState={{ disabled }}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!disabled}
            keyboardType="numbers-and-punctuation"
            onBlur={() => setFocused(false)}
            onChangeText={(text) => onChange(text.trim() === '' ? null : text.trim())}
            onFocus={() => setFocused(true)}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={palette.mutedForeground}
            style={[styles.text, styles.rowInput, { color: palette.foreground }]}
            testID={testID ? `${testID}-input` : undefined}
            value={value ?? ''}
          />
          {clear}
        </View>
        {rowFooter}
      </View>
    )
  }

  if (!usesNativePicker) {
    return (
      <View style={styles.field} testID={testID}>
        <Text variant="metaStrong">
          {label}
        </Text>
        <View style={boxStyle}>
          <TextInput
            accessibilityHint={helperText}
            accessibilityLabel={label}
            accessibilityState={{ disabled }}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!disabled}
            keyboardType="numbers-and-punctuation"
            onBlur={() => setFocused(false)}
            onChangeText={(text) => onChange(text.trim() === '' ? null : text.trim())}
            onFocus={() => setFocused(true)}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={palette.mutedForeground}
            style={[styles.text, styles.input, { color: palette.foreground }]}
            testID={testID ? `${testID}-input` : undefined}
            value={value ?? ''}
          />
          {clear}
        </View>
        {footer}
      </View>
    )
  }

  const shown = selected ? (formatValue?.(selected) ?? formatForDisplay(selected, i18n.language)) : null
  const initial = () => clamp(selected ?? today(), min, max)

  const commit = (date: Date) => {
    const next = formatIsoDate(date)
    if (next !== value) onChange(next)
  }

  const toggle = () => {
    if (disabled) return
    if (!open) setDraft(initial())
    setOpen((current) => !current)
  }

  const trigger = row ? (
    <View style={rowStyle}>
      <Pressable
        accessibilityHint={helperText}
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{ disabled, expanded: Platform.OS === 'ios' ? open : undefined }}
        accessibilityValue={{ text: shown ?? t('common.dateNotSet') }}
        disabled={disabled}
        onBlur={() => setFocused(false)}
        onFocus={() => setFocused(true)}
        onPress={toggle}
        style={({ pressed }) => [styles.rowTrigger, pressed && styles.pressed]}
        testID={testID ? `${testID}-trigger` : undefined}
      >
        <Text style={styles.rowLabel} tone={error ? 'destructive' : 'default'} variant="body">
          {label}
        </Text>
        <Text numberOfLines={1} style={styles.rowValue} tone={shown ? 'default' : 'muted'} variant="body">
          {shown ?? t('common.selectDate')}
        </Text>
      </Pressable>
      {clear}
    </View>
  ) : (
    <>
      <Text variant="metaStrong">
        {label}
      </Text>
      <View style={boxStyle}>
        <Pressable
          accessibilityHint={helperText}
          accessibilityLabel={label}
          accessibilityRole="button"
          accessibilityState={{ disabled, expanded: Platform.OS === 'ios' ? open : undefined }}
          accessibilityValue={{ text: shown ?? t('common.dateNotSet') }}
          disabled={disabled}
          onBlur={() => setFocused(false)}
          onFocus={() => setFocused(true)}
          hitSlop={{ top: 3, bottom: 3 }}
          onPress={toggle}
          style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
          testID={testID ? `${testID}-trigger` : undefined}
        >
          <Icon color={palette.mutedForeground} name="calendar" />
          <Text numberOfLines={1} style={styles.text} tone={shown ? 'default' : 'muted'} variant="body">
            {shown ?? t('common.selectDate')}
          </Text>
        </Pressable>
        {clear}
      </View>
    </>
  )

  return (
    <View style={row ? null : styles.field} testID={testID}>
      {trigger}
      {row ? rowFooter : footer}
      {open && Platform.OS === 'android' ? (
        <NativeDatePicker
          accentColor={palette.primary}
          maximumDate={max ?? undefined}
          minimumDate={min ?? undefined}
          mode="date"
          negativeButton={{ label: t('common.cancel') }}
          onDismiss={() => setOpen(false)}
          onValueChange={(_event, date) => {
            setOpen(false)
            commit(date)
          }}
          positiveButton={{ label: t('common.done') }}
          presentation="dialog"
          themeVariant={scheme}
          value={draft ?? initial()}
        />
      ) : null}
      {open && Platform.OS === 'ios' ? (
        <View style={[styles.inlinePicker, row && styles.rowPicker]}>
          <NativeDatePicker
            accentColor={palette.primary}
            display="inline"
            locale={i18n.language}
            maximumDate={max ?? undefined}
            minimumDate={min ?? undefined}
            mode="date"
            onValueChange={(_event, date) => {
              setDraft(date)
              commit(date)
            }}
            testID={testID ? `${testID}-picker` : undefined}
            themeVariant={scheme}
            value={draft ?? initial()}
          />
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              // Tapping the day already shown fires no change, so "Done" is what
              // commits it when the field started empty.
              commit(draft ?? initial())
              setOpen(false)
            }}
            style={({ pressed }) => [styles.done, pressed && styles.pressed]}
          >
            <Text tone="primary" variant="action">
              {t('common.done')}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

function ClearButton({ label, onPress, palette }: { label: string; onPress: () => void; palette: Palette }) {
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.clear, pressed && styles.pressed]}>
      <SymbolView name={{ ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' }} size={18} tintColor={palette.mutedForeground} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  field: { gap: themeTokens.spacing[2] },
  // Web's Input: 40pt drawn (`h-10`), like every other field (transactions/form-field);
  // the trigger's hitSlop takes the finger to 44.
  box: {
    minHeight: themeTokens.size.control,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: themeTokens.radius.md,
  },
  // Focus and error both take the 2px boundary (DESIGN.md state contract).
  boxEmphasis: { borderWidth: 2 },
  trigger: {
    flex: 1,
    minHeight: themeTokens.size.control - 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: themeTokens.spacing[2],
    paddingHorizontal: themeTokens.spacing[3],
  },
  text: { ...textStyles.body, flexShrink: 1 },
  input: { flex: 1, minHeight: themeTokens.size.control - 2, paddingHorizontal: themeTokens.spacing[3], paddingVertical: themeTokens.spacing[2] },
  clear: { width: themeTokens.touchTarget.minimum, minHeight: themeTokens.size.control - 2, alignItems: 'center', justifyContent: 'center' },
  inlinePicker: { gap: themeTokens.spacing[2] },
  done: { alignSelf: 'flex-end', minHeight: themeTokens.touchTarget.minimum, minWidth: themeTokens.touchTarget.minimum, justifyContent: 'center', paddingHorizontal: themeTokens.spacing[3] },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: themeTokens.spacing[4] },
  rowFocused: { borderWidth: 2, borderRadius: themeTokens.radius.xl },
  rowTrigger: { flex: 1, minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[4] },
  rowLabel: { flexShrink: 0 },
  rowValue: { flex: 1, minWidth: 0, textAlign: 'right' },
  rowInput: { flex: 1, minHeight: themeTokens.touchTarget.minimum, textAlign: 'right', padding: 0 },
  rowNote: { paddingHorizontal: themeTokens.spacing[4], paddingBottom: themeTokens.spacing[3] },
  rowPicker: { paddingHorizontal: themeTokens.spacing[4], paddingBottom: themeTokens.spacing[3] },
})
