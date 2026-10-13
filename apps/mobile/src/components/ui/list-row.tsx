import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'

import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

export type ListRowProps = {
  /** The line the row is scanned by. Foreground ink. */
  title: string
  /** Muted lines beneath the title. `null`/`undefined` entries are dropped. */
  meta?: (string | null | undefined)[]
  /** Right-aligned figure — usually an `<Amount>`. */
  figure?: React.ReactNode
  /** A second, smaller right-aligned line under the figure. */
  figureMeta?: React.ReactNode
  /** Rendered inline with the title. A `<Badge>` belongs here, not in a column. */
  badge?: React.ReactNode
  /** Leading element — an institution logo, an avatar, a category swatch. */
  leading?: React.ReactNode
  onPress?: () => void
  /** Draws the hairline above this row. Set on every row but the first. */
  separated?: boolean
  accessibilityLabel?: string
  style?: StyleProp<ViewStyle>
  testID?: string
}

/**
 * One row, several facts, no wrapping.
 *
 * A stacked left column — primary line in foreground ink, muted lines beneath —
 * with the figure right-aligned so decimal points stack down the column. This
 * is the shape the phone gets instead of squeezing a desktop table's columns
 * into 375px: the row *restructures*, it does not shrink.
 *
 * `numberOfLines={1}` on the meta lines is deliberate. The technique depends on
 * a fixed number of lines per row; a row that wraps to four lines on one entry
 * and two on the next destroys the scan.
 */
export function ListRow({
  title,
  meta,
  figure,
  figureMeta,
  badge,
  leading,
  onPress,
  separated = false,
  accessibilityLabel,
  style,
  testID,
}: ListRowProps) {
  const palette = usePalette()
  const lines = (meta ?? []).filter((line): line is string => Boolean(line))

  const body = (
    <>
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <View style={styles.main}>
        <View style={styles.titleRow}>
          <Text numberOfLines={1} variant="bodyStrong" style={styles.title}>
            {title}
          </Text>
          {badge}
        </View>
        {lines.map((line, index) => (
          <Text key={index} numberOfLines={1} variant="meta" tone="muted">
            {line}
          </Text>
        ))}
      </View>
      {figure || figureMeta ? (
        <View style={styles.figures}>
          {figure}
          {figureMeta}
        </View>
      ) : null}
    </>
  )

  const rowStyle = [
    styles.row,
    separated && { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: palette.border },
    style,
  ]

  if (!onPress) {
    return (
      <View accessibilityLabel={accessibilityLabel} accessible style={rowStyle} testID={testID}>
        {body}
      </View>
    )
  }

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [...rowStyle, pressed && { backgroundColor: palette.muted }]}
      testID={testID}
    >
      {body}
    </Pressable>
  )
}

/**
 * The container a run of `ListRow`s sits in.
 *
 * A list sits on the canvas separated by hairline rules rather than wrapped in
 * a padded card — the card is reserved for things that are genuinely a unit.
 */
export function List({ children, style, testID }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  return (
    <View style={[styles.list, style]} testID={testID}>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  list: { width: '100%' },
  row: {
    minHeight: themeTokens.touchTarget.minimum,
    flexDirection: 'row',
    alignItems: 'center',
    gap: themeTokens.spacing[3],
    paddingVertical: themeTokens.spacing[3],
  },
  leading: { justifyContent: 'center' },
  // `minWidth: 0` lets the title truncate instead of pushing the figure off
  // the right edge — the flex default of `auto` would size to the content.
  main: { flex: 1, minWidth: 0, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2] },
  title: { flexShrink: 1 },
  figures: { alignItems: 'flex-end', gap: 2 },
})
