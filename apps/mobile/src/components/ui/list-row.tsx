import { Children, useState } from 'react'
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'

import { Icon } from '@/components/ui/icon'
import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

export type ListRowProps = {
  /** The line the row is scanned by. Foreground 14/500 (web `text-sm font-medium`). */
  title: string
  /** Muted 12px lines beneath the title ("Caixa Conta Extracto · Nov 3, 2026"). `null`/`undefined` entries are dropped. */
  meta?: (string | null | undefined)[]
  /** Right-aligned figure on the title line — usually `<Amount size="amount">`. */
  figure?: React.ReactNode
  /** A second, smaller right-aligned line under the figure ("≈ €828.00", "Remaining"). */
  figureMeta?: React.ReactNode
  /** Rendered inline with the title. A `<Badge>` belongs here, not in a column. */
  badge?: React.ReactNode
  /** Leading element — an institution logo, an avatar, a category swatch. */
  leading?: React.ReactNode
  /** Any extra content under the meta lines (a progress bar, a review note). */
  children?: React.ReactNode
  onPress?: () => void
  /**
   * Web's row actions menu: a trailing "…" (32pt, 44pt to the finger). The
   * row's own press still opens the row; this opens the menu.
   */
  onMorePress?: () => void
  /** Accessible name for the "…" button ("Actions for Starbucks"). Required with `onMorePress`. */
  moreAccessibilityLabel?: string
  /** Draws the hairline above this row. Set on every row but the first, or use `<List divided>`. */
  separated?: boolean
  /**
   * `compact` (default): web's ledger, title 14/500 and meta 12. `comfortable`:
   * the calm-structure row, title 16/500 and meta 14 muted, for screens where
   * the list is the page (the transactions ledger).
   */
  density?: 'compact' | 'comfortable'
  accessibilityLabel?: string
  style?: StyleProp<ViewStyle>
  testID?: string
}

/**
 * One row of a ledger — web's mobile transactions row
 * (`AccountTransactionsTable` `MobileTransactionsList`): name and figure on
 * the first line, the "…" menu at the end, muted meta lines beneath, `py-3`,
 * hairline between rows. The row restructures on a phone; it never shrinks.
 */
export function ListRow({
  title,
  meta,
  figure,
  figureMeta,
  badge,
  leading,
  children,
  onPress,
  onMorePress,
  moreAccessibilityLabel,
  separated = false,
  density = 'compact',
  accessibilityLabel,
  style,
  testID,
}: ListRowProps) {
  const comfortable = density === 'comfortable'
  const palette = usePalette()
  const [pressed, setPressed] = useState(false)
  const lines = (meta ?? []).filter((line): line is string => Boolean(line))

  const content = (
    <>
      <View style={styles.titleRow}>
        <View style={styles.titleGroup}>
          <Text numberOfLines={1} style={styles.title} variant={comfortable ? 'bodyStrong' : 'metaStrong'}>
            {title}
          </Text>
          {badge}
        </View>
        {figure ? <View style={styles.figure}>{figure}</View> : null}
      </View>
      {lines.length > 0 || figureMeta ? (
        <View style={styles.metaRow}>
          <View style={styles.metaLines}>
            {lines.map((line, index) => (
              <Text key={index} numberOfLines={1} tone="muted" variant={comfortable ? 'meta' : 'label'}>
                {line}
              </Text>
            ))}
          </View>
          {figureMeta ? <View style={styles.figure}>{figureMeta}</View> : null}
        </View>
      ) : null}
      {children}
    </>
  )

  // The leading element, the row's own press and the "…" are siblings, not
  // nested: VoiceOver reaches a leading control (a checkbox) and the menu on
  // their own, and the row reads as one element between them.
  return (
    <View
      style={[
        styles.row,
        separated && { borderTopWidth: 1, borderTopColor: palette.border },
        style,
        pressed && { backgroundColor: palette.muted },
      ]}
    >
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      {onPress ? (
        <Pressable
          accessibilityLabel={accessibilityLabel ?? title}
          accessibilityRole="button"
          onPress={onPress}
          onPressIn={() => setPressed(true)}
          onPressOut={() => setPressed(false)}
          style={styles.main}
          testID={testID}
        >
          {content}
        </Pressable>
      ) : (
        <View accessibilityLabel={accessibilityLabel} accessible style={styles.main} testID={testID}>
          {content}
        </View>
      )}
      {onMorePress ? (
        <Pressable
          accessibilityLabel={moreAccessibilityLabel ?? title}
          accessibilityRole="button"
          hitSlop={6}
          onPress={onMorePress}
          style={({ pressed: morePressed }) => [styles.more, morePressed && { backgroundColor: palette.accent }]}
        >
          <Icon color={palette.foreground} name="more-horizontal" />
        </Pressable>
      ) : null}
    </View>
  )
}

/**
 * The container a run of `ListRow`s sits in: on the canvas, hairlines between
 * rows, no card. `divided` draws the hairlines for you (web `divide-y`);
 * `ruled` adds web's ledger bottom rule (`border-b`).
 */
export function List({
  children,
  divided = false,
  ruled = false,
  style,
  testID,
}: {
  children: React.ReactNode
  divided?: boolean
  ruled?: boolean
  style?: StyleProp<ViewStyle>
  testID?: string
}) {
  const palette = usePalette()
  return (
    <View
      style={[styles.list, ruled && { borderBottomWidth: 1, borderBottomColor: palette.border }, style]}
      testID={testID}
    >
      {divided
        ? Children.toArray(children).map((child, index) => (
              <View key={index} style={index > 0 ? { borderTopWidth: 1, borderTopColor: palette.border } : null}>
                {child}
              </View>
            ))
        : children}
    </View>
  )
}

/**
 * The month that opens a run of ledger rows ("October 2025") — web's
 * `LedgerMonthLabel` line, 14/600 foreground. Pass `separated` on every
 * group after the first for the heavier month rule web draws.
 *
 * `variant="heading"` is the calm-structure month: a 20/600 heading with
 * space above it instead of a rule (pass `first` on the opening group so it
 * doesn't start with a gap).
 */
export function ListGroupHeading({
  title,
  separated = false,
  variant = 'line',
  first = false,
  testID,
}: {
  title: string
  separated?: boolean
  variant?: 'line' | 'heading'
  first?: boolean
  testID?: string
}) {
  const palette = usePalette()
  if (variant === 'heading') {
    return (
      <View style={[styles.heading, first && styles.headingFirst]} testID={testID}>
        <Text accessibilityRole="header" variant="heading">
          {title}
        </Text>
      </View>
    )
  }
  return (
    <View style={[styles.group, separated && { borderTopWidth: 1, borderTopColor: palette.border }]} testID={testID}>
      <Text accessibilityRole="header" style={styles.groupTitle} variant="metaStrong">
        {title}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  list: { width: '100%' },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: themeTokens.spacing[3],
  },
  leading: { justifyContent: 'center', alignSelf: 'center', paddingVertical: themeTokens.spacing[3] },
  // `minWidth: 0` lets the title truncate instead of pushing the figure off
  // the right edge — the flex default of `auto` would size to the content.
  // The row's padding lives here so the pressable itself is the 44pt target.
  main: { flex: 1, minWidth: 0, minHeight: themeTokens.touchTarget.minimum, paddingVertical: themeTokens.spacing[3], gap: themeTokens.spacing[1] },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: themeTokens.spacing[3] },
  titleGroup: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2], flex: 1, minWidth: 0 },
  title: { flexShrink: 1 },
  figure: { alignItems: 'flex-end', flexShrink: 0 },
  metaRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: themeTokens.spacing[3] },
  metaLines: { flex: 1, minWidth: 0, gap: 2 },
  more: {
    width: 32,
    height: 32,
    marginTop: themeTokens.spacing[2],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: themeTokens.radius.md,
  },
  group: { paddingTop: themeTokens.spacing[3], paddingBottom: themeTokens.spacing[1] },
  groupTitle: { fontWeight: '600' },
  heading: { paddingTop: themeTokens.spacing[8], paddingBottom: themeTokens.spacing[1] },
  headingFirst: { paddingTop: themeTokens.spacing[4] },
})
