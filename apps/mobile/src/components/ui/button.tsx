import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'

import { Icon, type IconName } from '@/components/ui/icon'
import { Text } from '@/components/ui/text'
import { themeTokens, type Palette } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'destructive' | 'destructive-quiet' | 'ghost' | 'link'

/** Web's `size` scale: `default` h-10, `sm` h-9, `icon` a 40×40 square (pass `icon`, no visible label). */
export type ButtonSize = 'default' | 'sm' | 'icon'

export type ButtonProps = {
  label: string
  onPress: () => void | Promise<void>
  variant?: ButtonVariant
  disabled?: boolean
  /** Sets `disabled` and `accessibilityState.busy`, and wins over `disabled={false}`. */
  loading?: boolean
  /** Fills the available width. Standalone actions on a phone usually want this. */
  block?: boolean
  /** Alias of `block`, web's `className="w-full"`. */
  fullWidth?: boolean
  /** A leading glyph, web's `<Plus className="size-4" />` before the label. */
  icon?: IconName
  /** A trailing glyph (web "Accounts linked 🔗"-style buttons put it after). */
  trailingIcon?: IconName
  size?: ButtonSize
  /**
   * A count pill after the label (web's "Filters (2)": `h-5 min-w-5 rounded-full
   * px-1.5 text-xs font-medium`). Hidden at 0. Put the count in
   * `accessibilityLabel` too; the pill itself is not read separately.
   */
  count?: number
  /** `primary` (reports' filled violet pill) or `secondary` (the ledger's muted Badge). */
  countTone?: 'primary' | 'secondary'
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
 * - `destructive-quiet` — destructive ink, no box, body-strong label, 44pt
 *                 tall and hugging the start edge: a flow's "Delete X" at the
 *                 bottom of the screen, never in the bar. Pair with
 *                 `icon="trash"`; `loading` swaps the glyph for a spinner.
 * - `ghost`     — text only, for a tertiary action inside a dense row.
 * - `link`      — inline `primary` text, no box; for "Review them"-style links.
 *
 * Drawn at web's 40pt (`h-10`), 36 for `sm`, with `hitSlop` making the touch
 * target up to the 44pt floor. Label is 14/500 (`text-sm font-medium`).
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
  fullWidth = false,
  icon,
  trailingIcon,
  size = 'default',
  count,
  countTone = 'primary',
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
  const quiet = variant === 'destructive-quiet'
  const drawn = quiet ? themeTokens.touchTarget.minimum : size === 'sm' ? themeTokens.size.controlSmall : themeTokens.size.control
  const slop = Math.max(0, (themeTokens.touchTarget.minimum - drawn) / 2)
  const iconOnly = size === 'icon'

  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ disabled: inert, busy: loading }}
      disabled={inert}
      hitSlop={{ top: slop, bottom: slop, left: iconOnly ? slop : 0, right: iconOnly ? slop : 0 }}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={() => void onPress()}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      testID={testID}
      style={[
        styles.base,
        { minHeight: drawn },
        size === 'sm' && styles.small,
        iconOnly && styles.icon,
        variant === 'link' && styles.link,
        quiet && styles.quiet,
        (block || fullWidth) && styles.block,
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
        {icon && !loading ? <Icon color={surface.label} name={icon} /> : null}
        {/* The label survives the loading state. A spinner replacing it is how
            someone loses track of which control they pressed — and a spinner
            over a live button is how a form gets submitted twice. An icon-size
            button keeps the label for screen readers only. */}
        {iconOnly ? null : (
          <Text variant={quiet ? 'bodyStrong' : 'action'} style={{ color: surface.label }}>
            {label}
          </Text>
        )}
        {count !== undefined && count > 0 && !iconOnly ? (
          <View
            style={[
              styles.count,
              { backgroundColor: countTone === 'primary' ? palette.primary : palette.secondary },
              countTone === 'secondary' && { borderWidth: 1, borderColor: palette.border },
            ]}
          >
            <Text style={[styles.countLabel, { color: countTone === 'primary' ? palette.primaryForeground : palette.secondaryForeground }]} variant="label">
              {count}
            </Text>
          </View>
        ) : null}
        {trailingIcon ? <Icon color={surface.label} name={trailingIcon} /> : null}
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
      return { background: palette.background, border: palette.primary, label: palette.primary }
    case 'destructive':
      return { background: palette.destructive, border: 'transparent', label: palette.destructiveForeground }
    case 'destructive-quiet':
      return { background: 'transparent', border: 'transparent', label: palette.destructiveText }
    case 'ghost':
      return { background: 'transparent', border: 'transparent', label: palette.foreground }
    case 'link':
      return { background: 'transparent', border: 'transparent', label: palette.primary }
  }
}

const styles = StyleSheet.create({
  base: {
    borderRadius: themeTokens.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: themeTokens.spacing[4],
    paddingVertical: themeTokens.spacing[2],
  },
  small: { paddingHorizontal: themeTokens.spacing[3] },
  icon: { width: themeTokens.size.control, paddingHorizontal: 0 },
  link: { paddingHorizontal: 0, alignSelf: 'flex-start' },
  quiet: { paddingHorizontal: themeTokens.spacing[1], paddingVertical: 0, alignSelf: 'flex-start' },
  block: { alignSelf: 'stretch' },
  content: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2] },
  count: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    marginLeft: themeTokens.spacing[1],
    borderRadius: themeTokens.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countLabel: { fontWeight: '500' },
  pressed: { opacity: 0.72 },
  inert: { opacity: 0.5 },
})
