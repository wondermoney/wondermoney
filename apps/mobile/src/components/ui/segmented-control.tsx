import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

export type SegmentOption<T extends string> = { value: T; label: string }

/**
 * A choice between a small, fixed set of views — Month | Year, Active | Archived.
 *
 * Mirrors web's `TabsList` / `TabsTrigger` (`components/ui/tabs.tsx`): a muted
 * track (`bg-muted h-10 p-1 rounded-md`), each segment `px-3 py-1.5 text-sm
 * font-medium`, the selected one lifted onto the canvas (`bg-background
 * text-foreground shadow-xs`), the rest muted ink. No violet: web spends no
 * accent here, and neither does this.
 *
 * Segments draw at 32pt; `hitSlop` makes each 44pt to the finger.
 * `accessibilityState.selected` announces the state, so colour never carries it alone.
 *
 * @param options      the segments, in order.
 * @param value        the selected option's value.
 * @param onChange     called with the pressed option's value.
 * @param accessibilityLabel  names the group ("Period").
 * @param scrollable   for more options than fit: they scroll instead of wrapping.
 * @param size         `sm` draws the track at 36pt to sit beside 36pt buttons in a control row.
 * @param fill         stretches the track to the full width and shares it equally between the
 *                     segments (a flow's Expense | Income | Transfer, a chart's range switch).
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  scrollable = false,
  size = 'default',
  fill = false,
  testID,
}: {
  options: readonly SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  accessibilityLabel: string
  scrollable?: boolean
  size?: 'default' | 'sm'
  fill?: boolean
  testID?: string
}) {
  const palette = usePalette()
  const [focused, setFocused] = useState<T | null>(null)
  const small = size === 'sm'
  const segmentHeight = small ? SEGMENT_HEIGHT_SMALL : SEGMENT_HEIGHT
  const slop = (themeTokens.touchTarget.minimum - segmentHeight) / 2

  const segments = options.map((option) => {
    const selected = option.value === value
    return (
      <Pressable
        accessibilityLabel={option.label}
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        key={option.value}
        // Vertical only: horizontal slop would overlap the neighbouring segment.
        hitSlop={{ top: slop, bottom: slop }}
        onBlur={() => setFocused(null)}
        onFocus={() => setFocused(option.value)}
        onPress={() => onChange(option.value)}
        style={({ pressed }) => [
          styles.segment,
          small && styles.segmentSmall,
          fill && styles.segmentFill,
          selected
            ? [{ backgroundColor: palette.background }, themeTokens.shadow.xs]
            : { backgroundColor: 'transparent' },
          focused === option.value && { borderWidth: 2, borderColor: palette.ring },
          pressed && styles.pressed,
        ]}
      >
        {/* One line per label, never a word broken mid-way: the font shrinks to fit instead. */}
        <Text adjustsFontSizeToFit minimumFontScale={0.7} numberOfLines={1} style={{ color: selected ? palette.foreground : palette.mutedForeground }} variant="metaStrong">
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
        contentContainerStyle={[styles.track, small && styles.trackSmall, { backgroundColor: palette.muted }]}
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
      style={[styles.track, small && styles.trackSmall, { backgroundColor: palette.muted, alignSelf: fill ? 'stretch' : 'flex-start' }]}
      testID={testID}
    >
      {segments}
    </View>
  )
}

const SEGMENT_HEIGHT = 32
const SEGMENT_HEIGHT_SMALL = 28

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: themeTokens.size.control,
    padding: themeTokens.spacing[1],
    borderRadius: themeTokens.radius.md,
  },
  trackSmall: { minHeight: themeTokens.size.controlSmall, padding: 4 },
  segmentSmall: { minHeight: SEGMENT_HEIGHT_SMALL, paddingHorizontal: themeTokens.spacing[2] },
  segment: {
    minHeight: SEGMENT_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: themeTokens.spacing[3],
    borderRadius: themeTokens.radius.sm,
  },
  segmentFill: { flex: 1, alignItems: 'center' },
  pressed: { opacity: 0.72 },
})
