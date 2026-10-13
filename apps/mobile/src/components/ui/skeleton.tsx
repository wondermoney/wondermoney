import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'

import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

/**
 * A skeleton with the *real* proportions of the thing it replaces.
 *
 * A generic block that doesn't match its content is a layout shift with extra
 * steps: the page settles, then jumps. These are built from the same row and
 * header shapes the loaded screen uses, so the transition is a fill rather than
 * a reflow.
 *
 * Deliberately static — no shimmer. A pulsing gradient is decoration, and the
 * system does not animate to say "working"; the presence of the skeleton
 * already says it.
 */
export function SkeletonBlock({ width, height, style }: { width?: number | `${number}%`; height: number; style?: StyleProp<ViewStyle> }) {
  const palette = usePalette()
  return (
    <View
      accessible={false}
      style={[styles.block, { width: width ?? '100%', height, backgroundColor: palette.muted }, style]}
    />
  )
}

/** Matches `PageHeader`, so the title does not appear late and push everything down. */
export function PageHeaderSkeleton() {
  return (
    <View style={styles.header}>
      <SkeletonBlock height={26} width={160} />
      <SkeletonBlock height={16} width={110} />
    </View>
  )
}

/** Matches `ListRow`: a stacked left column and a right-aligned figure. */
export function ListRowSkeleton({ separated = false, metaLines = 2 }: { separated?: boolean; metaLines?: number }) {
  const palette = usePalette()
  return (
    <View
      accessible={false}
      style={[styles.row, separated && { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: palette.border }]}
    >
      <View style={styles.rowMain}>
        <SkeletonBlock height={15} width={168} />
        {Array.from({ length: metaLines }, (_, index) => (
          <SkeletonBlock height={13} key={index} width={index === 0 ? 128 : 96} />
        ))}
      </View>
      <SkeletonBlock height={15} width={84} />
    </View>
  )
}

/**
 * A whole loading screen: header plus a run of rows.
 *
 * `label` is what a screen reader announces. It is required — a screen that is
 * loading silently is a screen that appears empty.
 */
export function ScreenSkeleton({ label, rows = 6 }: { label: string; rows?: number }) {
  return (
    <View accessibilityLabel={label} accessibilityRole="progressbar" accessible style={styles.screen}>
      <PageHeaderSkeleton />
      <View>
        {Array.from({ length: rows }, (_, index) => (
          <ListRowSkeleton key={index} separated={index > 0} />
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  block: { borderRadius: themeTokens.radius.sm, maxWidth: '100%' },
  header: { gap: themeTokens.spacing[2] },
  screen: { gap: themeTokens.spacing[6] },
  row: {
    minHeight: themeTokens.touchTarget.minimum,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: themeTokens.spacing[3],
    paddingVertical: themeTokens.spacing[3],
  },
  rowMain: { flex: 1, minWidth: 0, gap: themeTokens.spacing[1] },
})
