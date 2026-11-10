import { useState } from 'react'
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native'

import { Icon, type IconName } from '@/components/ui/icon'
import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

export type SelectTriggerProps = {
  /** The chosen option's label ("Year to Date"). `null`/empty shows `placeholder` in muted ink. */
  value?: string | null
  placeholder?: string
  /** Opens whatever picker the screen owns (a sheet, an action sheet). */
  onPress: () => void
  /** Names the control for screen readers ("Period"); the value is appended. */
  accessibilityLabel: string
  disabled?: boolean
  /** Fills the available width (web `w-full`). Default hugs content, min 180pt like web's timeframe select. */
  block?: boolean
  /** Marks the field invalid: the border switches to `destructiveText`. */
  invalid?: boolean
  /** A muted leading glyph (web's `<Calendar className="size-4" />` in a date-range trigger). */
  icon?: IconName
  /** `sm` is 36pt and hugs its content, for a select inside a control row beside 36pt buttons. */
  size?: 'default' | 'sm'
  style?: StyleProp<ViewStyle>
  testID?: string
}

/**
 * The closed state of a select — web's `SelectTrigger` (`components/ui/Select.tsx`):
 * 40pt, `input` border, 6pt radius, `px-3`, 14px foreground value, a muted
 * chevron at the end. It only draws the trigger; the screen opens its own picker.
 */
export function SelectTrigger({
  value,
  placeholder,
  onPress,
  accessibilityLabel,
  disabled = false,
  block = false,
  invalid = false,
  icon,
  size = 'default',
  style,
  testID,
}: SelectTriggerProps) {
  const palette = usePalette()
  const [focused, setFocused] = useState(false)
  const hasValue = Boolean(value)
  const small = size === 'sm'
  const slop = (themeTokens.touchTarget.minimum - (small ? themeTokens.size.controlSmall : themeTokens.size.control)) / 2

  return (
    <Pressable
      accessibilityLabel={hasValue ? `${accessibilityLabel}, ${value}` : accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled, expanded: false }}
      disabled={disabled}
      hitSlop={{ top: slop, bottom: slop }}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.trigger,
        block ? styles.block : small ? styles.hugSmall : styles.hug,
        small && styles.small,
        {
          borderColor: focused ? palette.ring : invalid ? palette.destructiveText : palette.input,
          borderWidth: focused ? 2 : 1,
          backgroundColor: palette.background,
        },
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
      testID={testID}
    >
      {icon ? <Icon color={palette.mutedForeground} name={icon} /> : null}
      <Text numberOfLines={1} style={[styles.value, small && !block && styles.valueHug]} tone={hasValue ? 'default' : 'muted'} variant="meta">
        {hasValue ? value : placeholder ?? ''}
      </Text>
      <Icon color={palette.mutedForeground} name="chevron-down" />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  trigger: {
    minHeight: themeTokens.size.control,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: themeTokens.spacing[2],
    paddingHorizontal: themeTokens.spacing[3],
    borderRadius: themeTokens.radius.md,
  },
  hug: { alignSelf: 'flex-start', minWidth: 180 },
  hugSmall: { alignSelf: 'flex-start' },
  small: { minHeight: themeTokens.size.controlSmall },
  block: { alignSelf: 'stretch' },
  value: { flexShrink: 1, flexGrow: 1 },
  // A growing label would stretch a hugging trigger to the row's width.
  valueHug: { flexGrow: 0 },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.5 },
})
