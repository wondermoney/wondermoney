import { useState } from 'react'
import { Pressable, StyleSheet } from 'react-native'

import { Icon, type IconName } from '@/components/ui/icon'
import { useBottomInset } from '@/components/ui/screen-safe-area'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

/** The button's drawn size; also what a list adds under its last row so the button never covers it. */
export const FLOATING_ACTION_SIZE = 56
const OFFSET = themeTokens.layout.screenPadding

/**
 * A list screen's add action, always in the same place: a 56pt violet circle
 * with a plus, 16pt in from the bottom-right corner.
 *
 * Render it as the last child of a `flex: 1` container that holds the screen
 * (a sibling of the `SafeAreaView`, not inside the `ScrollView`). It adds the
 * bottom safe-area inset itself; on a screen inside the tab group the bar
 * already sits on that inset, so pass `aboveTabBar` and it keeps only the
 * 16pt offset.
 *
 * Give the list `paddingBottom: FLOATING_ACTION_SIZE + 32` so the last row
 * scrolls clear of it.
 */
export function FloatingActionButton({
  accessibilityLabel,
  onPress,
  icon = 'plus',
  disabled = false,
  aboveTabBar = false,
  testID,
}: {
  /** Required: what the button adds ("Add transaction"). */
  accessibilityLabel: string
  onPress: () => void
  icon?: IconName
  disabled?: boolean
  aboveTabBar?: boolean
  testID?: string
}) {
  const palette = usePalette()
  const inset = useBottomInset()
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: palette.primary, bottom: OFFSET + (aboveTabBar ? 0 : inset) },
        themeTokens.shadow.overlay,
        focused && { borderWidth: 2, borderColor: palette.ring },
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
      testID={testID}
    >
      <Icon color={palette.primaryForeground} name={icon} size={24} weight="semibold" />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    right: OFFSET,
    width: FLOATING_ACTION_SIZE,
    height: FLOATING_ACTION_SIZE,
    borderRadius: FLOATING_ACTION_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Opacity, not a lighter fill: the plus keeps its contrast while pressed.
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
})
