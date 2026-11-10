import { Children, isValidElement, useRef, useState } from 'react'
import { Pressable, StyleSheet, Switch, TextInput, View, type TextInputInstance, type TextInputProps } from 'react-native'

import { OptionSheet, type SheetOption } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'
import { usePalette } from '@/theme/use-palette'

/** A form row's minimum height: the label and value on one 56pt line. */
export const FORM_ROW_HEIGHT = 56

/**
 * A run of form rows in one subtle rounded container, hairlines between the
 * rows. The container is the only box; rows inside it never draw their own.
 */
export function FormGroup({ children, testID }: { children: React.ReactNode; testID?: string }) {
  const palette = usePalette()
  const rows = Children.toArray(children).filter(isValidElement)
  return (
    <View style={[styles.group, { borderColor: palette.border }]} testID={testID}>
      {rows.map((row, index) => (
        <View key={row.key ?? index} style={index > 0 ? { borderTopWidth: 1, borderTopColor: palette.border } : null}>
          {row}
        </View>
      ))}
    </View>
  )
}

/** The muted or destructive line under a row: a hint, a search status, an error. */
export function FormRowNote({ children, tone = 'muted', alert = false }: { children: string; tone?: 'muted' | 'destructive'; alert?: boolean }) {
  return (
    <Text accessibilityLiveRegion={alert ? 'polite' : undefined} accessibilityRole={alert ? 'alert' : undefined} style={styles.note} tone={tone} variant="meta">
      {children}
    </Text>
  )
}

export type FormRowProps = {
  /** The row's name, left, body in foreground ("Category"). */
  label: string
  /** The current value, right. `null` or empty shows `placeholder` in muted ink. */
  value?: string | null
  /** "Choose", "None", "Today". */
  placeholder?: string
  onPress: () => void
  /** The accessible name's first half when it should differ from the visible label ("Category (optional)"). */
  accessibilityLabel?: string
  disabled?: boolean
  /** A destructive message under the row; it also marks the label. */
  error?: string | null
  /** A muted line under the row. */
  hint?: string | null
  expanded?: boolean
  /** A decorative mark before the value (the chosen account's `EntityMark size="sm"`). */
  valueLeading?: React.ReactNode
  testID?: string
}

/**
 * One form field as a row: the label on the left, the value on the right,
 * 56pt tall. Tapping it opens the sheet or picker that changes it. The
 * accessible name is "Label, value" so the row reads as one control.
 */
export function FormRow({ label, value, placeholder, onPress, accessibilityLabel, disabled = false, error, hint, expanded, valueLeading, testID }: FormRowProps) {
  const palette = usePalette()
  const [focused, setFocused] = useState(false)
  const shown = value ? value : placeholder ?? ''
  return (
    <View>
      <Pressable
        accessibilityLabel={`${accessibilityLabel ?? label}, ${shown}`}
        accessibilityRole="button"
        accessibilityState={{ disabled, expanded }}
        disabled={disabled}
        onBlur={() => setFocused(false)}
        onFocus={() => setFocused(true)}
        onPress={onPress}
        style={({ pressed }) => [
          styles.row,
          focused && [styles.focused, { borderColor: palette.ring }],
          pressed && { backgroundColor: palette.muted },
          disabled && styles.disabled,
        ]}
        testID={testID}
      >
        <Text style={styles.label} tone={error ? 'destructive' : 'default'} variant="body">
          {label}
        </Text>
        {value && valueLeading ? (
          <View style={styles.valueGroup}>
            {valueLeading}
            <Text numberOfLines={1} style={styles.valueBeside} tone="default" variant="body">
              {shown}
            </Text>
          </View>
        ) : (
          <Text numberOfLines={1} style={styles.value} tone={value ? 'default' : 'muted'} variant="body">
            {shown}
          </Text>
        )}
      </Pressable>
      {error ? <FormRowNote alert tone="destructive">{error}</FormRowNote> : hint ? <FormRowNote>{hint}</FormRowNote> : null}
    </View>
  )
}

/**
 * A `FormRow` that opens an `OptionSheet` of choices. Same contract as the
 * older `SelectField`: options in, the chosen value out.
 */
export function FormSelectRow<T extends string | number>({
  label,
  options,
  value,
  onChange,
  placeholder,
  sheetTitle,
  ...row
}: Omit<FormRowProps, 'value' | 'onPress' | 'expanded'> & {
  options: readonly SheetOption<T>[]
  value: T | null
  onChange: (value: T) => void
  placeholder: string
  /** The sheet's title; defaults to the label. */
  sheetTitle?: string
}) {
  const [open, setOpen] = useState(false)
  const current = options.find((option) => option.value === value) ?? null
  return (
    <>
      <FormRow {...row} expanded={open} label={label} onPress={() => setOpen(true)} placeholder={placeholder} value={current?.label ?? null} valueLeading={current?.leading} />
      <OptionSheet onClose={() => setOpen(false)} onSelect={onChange} options={options} title={sheetTitle ?? label} value={value} visible={open} />
    </>
  )
}

/**
 * A row the person types into: the label on the left, the text right-aligned
 * on the right. `multiline` (a note) puts the label above a growing field.
 * Tapping anywhere on the row focuses the input.
 */
export function FormTextRow({
  label,
  accessibilityLabel,
  error,
  hint,
  multiline = false,
  editable = true,
  testID,
  ...input
}: Omit<TextInputProps, 'style' | 'accessibilityLabel'> & {
  label: string
  /** The input's accessible name when it should differ from the visible label. */
  accessibilityLabel?: string
  error?: string | null
  hint?: string | null
  testID?: string
}) {
  const palette = usePalette()
  const ref = useRef<TextInputInstance>(null)
  const [focused, setFocused] = useState(false)
  return (
    <View>
      <Pressable
        accessible={false}
        disabled={!editable}
        onPress={() => ref.current?.focus()}
        style={[
          multiline ? styles.stacked : styles.row,
          focused && [styles.focused, { borderColor: palette.ring }],
          !editable && styles.disabled,
        ]}
      >
        <Text style={multiline ? null : styles.label} tone={error ? 'destructive' : 'default'} variant="body">
          {label}
        </Text>
        <TextInput
          ref={ref}
          accessibilityLabel={accessibilityLabel ?? label}
          accessibilityState={{ disabled: !editable }}
          editable={editable}
          multiline={multiline}
          placeholderTextColor={palette.mutedForeground}
          testID={testID}
          {...input}
          onBlur={(event) => { setFocused(false); input.onBlur?.(event) }}
          onFocus={(event) => { setFocused(true); input.onFocus?.(event) }}
          style={[styles.input, multiline ? styles.multiline : styles.inline, { color: palette.foreground }]}
        />
      </Pressable>
      {error ? <FormRowNote alert tone="destructive">{error}</FormRowNote> : hint ? <FormRowNote>{hint}</FormRowNote> : null}
    </View>
  )
}

/**
 * A yes/no field as a form row: the label (and an optional muted line) on the
 * left, the native switch on the right, 56pt, inside a `FormGroup` like the
 * other rows. The switch carries the accessible name ("label" unless
 * `accessibilityLabel` says otherwise), role `switch`, and its checked and
 * disabled state; tapping anywhere else on the row toggles it too, and the
 * row draws the focus ring while the switch has keyboard focus.
 */
export function FormSwitchRow({ label, hint, value, onValueChange, disabled = false, accessibilityLabel, accessibilityHint, testID }: {
  label: string
  /** A muted line under the label. */
  hint?: string | null
  value: boolean
  onValueChange: (next: boolean) => void
  disabled?: boolean
  /** The switch's accessible name when it should differ from the visible label. */
  accessibilityLabel?: string
  accessibilityHint?: string
  /** Set on the switch. */
  testID?: string
}) {
  const palette = usePalette()
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      accessible={false}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={({ pressed }) => [
        styles.row,
        focused && [styles.focused, { borderColor: palette.ring }],
        pressed && { backgroundColor: palette.muted },
        disabled && styles.disabled,
      ]}
    >
      <View style={styles.switchCopy}>
        <Text variant="body">{label}</Text>
        {hint ? <Text tone="muted" variant="meta">{hint}</Text> : null}
      </View>
      <Switch
        accessibilityHint={accessibilityHint}
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityRole="switch"
        accessibilityState={{ checked: value, disabled }}
        disabled={disabled}
        onBlur={() => setFocused(false)}
        onFocus={() => setFocused(true)}
        onValueChange={onValueChange}
        testID={testID}
        trackColor={{ false: palette.muted, true: palette.primary }}
        value={value}
      />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  group: { borderWidth: 1, borderRadius: themeTokens.radius.xl, overflow: 'hidden' },
  row: {
    minHeight: FORM_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: themeTokens.spacing[4],
    paddingHorizontal: themeTokens.spacing[4],
    paddingVertical: themeTokens.spacing[2],
  },
  stacked: { minHeight: FORM_ROW_HEIGHT, gap: themeTokens.spacing[1], paddingHorizontal: themeTokens.spacing[4], paddingVertical: themeTokens.spacing[3] },
  // Focus draws inside the row so the group's hairlines don't move.
  focused: { borderWidth: 2, borderRadius: themeTokens.radius.xl },
  // The label never truncates: it keeps its natural width (wrapping only past
  // two thirds of the row) and the value or input beside it shrinks instead.
  label: { flexShrink: 0, maxWidth: '66%' },
  value: { flex: 1, minWidth: 0, textAlign: 'right' },
  valueGroup: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: themeTokens.spacing[2] },
  valueBeside: { flexShrink: 1, textAlign: 'right' },
  input: { ...textStyles.body, padding: 0 },
  inline: { flex: 1, minWidth: 0, minHeight: themeTokens.touchTarget.minimum, textAlign: 'right' },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  switchCopy: { flex: 1, minWidth: 0, gap: themeTokens.spacing[1] },
  note: { paddingHorizontal: themeTokens.spacing[4], paddingBottom: themeTokens.spacing[3] },
  disabled: { opacity: 0.5 },
})
