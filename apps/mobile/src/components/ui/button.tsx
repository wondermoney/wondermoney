import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'

import { Text } from '@/components/ui/text'
import { themeTokens, type Palette } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'destructive' | 'ghost'

export type ButtonProps = {
  label: string
  onPress: () => void | Promise<void>
  variant?: ButtonVariant
  disabled?: boolean
  /** Sets `disabled` and `accessibilityState.busy`, and wins over `disabled={false}`. */
  loading?: boolean
  /** Fills the available width. Standalone actions on a phone usually want this. */
  block?: boolean
  style?: StyleProp<ViewStyle>
  accessibilityLabel?: string
  accessibilityHint?: string
  testID?: string
  /**
   * @deprecated The palette is read from the colour scheme now. Accepted so the
   * pre-port call sites keep compiling; ignored.
   */
  palette?: Palette
}

/**
 * The one button.
 *
 * Variants map to the system's registers rather than to a designer's mood:
 *
 * - `primary`   — the one action per section. Carries the accent.
 * - `secondary` — a quiet filled action. **Takes `border: input`**, because
 *                 `secondary` and `muted` are the same value, so on a muted
 *                 surface there is no fill doing the work and the shape would
 *                 otherwise measure 1.00:1 against its background.
 * - `outline`   — primary-tinted, for an action that wants attention without
 *                 being *the* action. Not a form control, not a third-party
 *                 sign-in.
 * - `destructive` — a solid destructive fill with its own foreground.
 * - `ghost`     — text only, for a tertiary action inside a dense row.
 *
 * Press is opacity, never a fade of the fill toward the canvas: fading a fill
 * raises its lightness and costs the label its contrast at exactly the moment
 * the finger is down.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  block = false,
  style,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: ButtonProps) {
  const palette = usePalette()
  const [pressed, setPressed] = useState(false)
  const [focused, setFocused] = useState(false)

  const inert = disabled || loading
  const surface = surfaceFor(variant, palette)

  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ disabled: inert, busy: loading }}
      disabled={inert}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={() => void onPress()}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      testID={testID}
      style={[
        styles.base,
        block && styles.block,
        {
          backgroundColor: surface.background,
          borderColor: focused ? palette.ring : surface.border,
          borderWidth: focused ? 2 : surface.border === 'transparent' ? 0 : 1,
        },
        pressed && styles.pressed,
        inert && styles.inert,
        style,
      ]}
    >
      <View style={styles.content}>
        {loading ? <ActivityIndicator color={surface.label} size="small" /> : null}
        {/* The label survives the loading state. A spinner replacing it is how
            someone loses track of which control they pressed — and a spinner
            over a live button is how a form gets submitted twice. */}
        <Text variant="action" style={{ color: surface.label }}>
          {label}
        </Text>
      </View>
    </Pressable>
  )
}

function surfaceFor(variant: ButtonVariant, palette: Palette): { background: string; border: string; label: string } {
  switch (variant) {
    case 'primary':
      return { background: palette.primary, border: 'transparent', label: palette.primaryForeground }
    case 'secondary':
      return { background: palette.secondary, border: palette.input, label: palette.secondaryForeground }
    case 'outline':
      return { background: 'transparent', border: palette.primary, label: palette.primary }
    case 'destructive':
      return { background: palette.destructive, border: 'transparent', label: palette.destructiveForeground }
    case 'ghost':
      return { background: 'transparent', border: 'transparent', label: palette.foreground }
  }
}

const styles = StyleSheet.create({
  base: {
    minHeight: themeTokens.touchTarget.minimum,
    borderRadius: themeTokens.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: themeTokens.spacing[4],
    paddingVertical: themeTokens.spacing[2],
  },
  block: { alignSelf: 'stretch' },
  content: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2] },
  pressed: { opacity: 0.72 },
  inert: { opacity: 0.5 },
})
