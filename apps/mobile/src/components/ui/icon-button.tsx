import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native'

import { Icon, type IconName } from '@/components/ui/icon'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

/**
 * A bare glyph control: the form bar's close and save, a title row's overflow
 * menu. No fill and no border, a 44pt square target, the glyph at 22pt.
 *
 * - `tone="primary"` draws the glyph in violet (the form bar's save); the
 *   default is foreground ink.
 * - `loading` swaps the glyph for a spinner and announces busy; the control
 *   stays the same size so nothing shifts while a save runs.
 * - Pressed is opacity, focus is the 2pt ring, disabled is 40% opacity.
 */
export function IconButton({
  icon,
  accessibilityLabel,
  onPress,
  tone = 'default',
  disabled = false,
  loading = false,
  style,
  testID,
}: {
  icon: IconName
  /** Required: the glyph is decorative, this is the control's name. */
  accessibilityLabel: string
  onPress: () => void
  tone?: 'default' | 'primary'
  disabled?: boolean
  loading?: boolean
  style?: StyleProp<ViewStyle>
  testID?: string
}) {
  const palette = usePalette()
  const [focused, setFocused] = useState(false)
  const inert = disabled || loading
  const ink = tone === 'primary' ? palette.primary : palette.foreground
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled: inert, busy: loading }}
      disabled={inert}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.target,
        focused && { borderWidth: 2, borderColor: palette.ring },
        pressed && styles.pressed,
        disabled && !loading && styles.disabled,
        style,
      ]}
      testID={testID}
    >
      {loading ? <ActivityIndicator color={ink} size="small" /> : <Icon color={ink} name={icon} size={GLYPH} weight={tone === 'primary' ? 'semibold' : 'regular'} />}
    </Pressable>
  )
}

const GLYPH = 22

const styles = StyleSheet.create({
  target: {
    width: themeTokens.touchTarget.minimum,
    height: themeTokens.touchTarget.minimum,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: themeTokens.radius.pill,
  },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.4 },
})
