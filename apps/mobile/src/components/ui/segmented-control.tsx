import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

export type SegmentOption<T extends string> = { value: T; label: string }

/**
 * A choice between a small, fixed set of views — a period, a range, a tab.
 *
 * The selected segment is one of the seven places the accent may appear. It
 * carries a `primaryWash` fill plus `primary` ink, and the unselected segments
 * carry neither: this is the whole reason the control reads at a glance.
 * Giving *every* segment a `primary` border is how a screen ends up with eight
 * accent elements and no answer to "which one is on".
 *
 * `accessibilityState.selected` does the announcing, so colour is not carrying
 * the state alone.
 *
 * One shared border around the whole track, not one border per segment — with
 * a border on every individual segment, three or more options read as a row of
 * separate boxes rather than one control (the
 * No-Nesting / box-stacking rule in `DESIGN.md`). The selected segment's inner
 * background wash is the only per-segment visual; unselected segments are
 * borderless and transparent.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  scrollable = false,
  testID,
}: {
  options: readonly SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  accessibilityLabel: string
  /** For more options than fit — they scroll rather than wrap into a block. */
  scrollable?: boolean
  testID?: string
}) {
  const palette = usePalette()

  const segments = options.map((option, index) => {
    const selected = option.value === value
    return (
      <Pressable
        accessibilityLabel={option.label}
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        key={option.value}
        // The control is 34pt tall but 48pt to the finger. Chips at full
        // touch-target height dominate a dense screen, and the fix is to grow
        // the *touch* area rather than the drawn one. Vertical only — adjacent
        // chips sit 8pt apart, and horizontal slop would overlap them.
        hitSlop={{ top: 7, bottom: 7 }}
        onPress={() => onChange(option.value)}
        style={({ pressed }) => [
          styles.segment,
          index > 0 && { borderLeftWidth: 1, borderLeftColor: palette.border },
          { backgroundColor: selected ? palette.primaryWash : 'transparent' },
          pressed && styles.pressed,
        ]}
      >
        <Text style={{ color: selected ? palette.primary : palette.mutedForeground }} variant="meta">
          {option.label}
        </Text>
      </Pressable>
    )
  })

  if (scrollable) {
    return (
      <ScrollView
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="tablist"
        contentContainerStyle={[styles.track, { borderColor: palette.input }]}
        horizontal
        showsHorizontalScrollIndicator={false}
        testID={testID}
      >
        {segments}
      </ScrollView>
    )
  }

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="tablist"
      style={[styles.track, { borderColor: palette.input, alignSelf: 'flex-start' }]}
      testID={testID}
    >
      {segments}
    </View>
  )
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: themeTokens.radius.md,
    overflow: 'hidden',
  },
  segment: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: themeTokens.spacing[3],
  },
  pressed: { opacity: 0.72 },
})
