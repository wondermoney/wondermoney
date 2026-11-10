import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'

import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

export type ProgressBarProps = {
  /** Filled share, 0–100. Clamped; a non-finite value draws empty. */
  value: number
  /** The fill, a palette value. Default `chart1` (web GoalProgressBar); `primary` for loans and budgets. */
  color?: string
  /** The track: `muted` (web `bg-muted`, default) or `border` (web `bg-border`, goals and loans). */
  track?: 'muted' | 'border'
  /** 8pt (web `h-2`, default) or 6pt (web `h-1.5`). */
  height?: 8 | 6
  /** On the fill, so a test can read its width. */
  testID?: string
  style?: StyleProp<ViewStyle>
}

/**
 * Web's progress bars (`GoalProgressBar`, the loans and budgets meters, share
 * bars in reports and recurring): a flat track with a filled share, `rounded-sm`.
 * Decorative: the figure it draws is always printed beside it.
 */
export function ProgressBar({ value, color, track = 'muted', height = 8, testID, style }: ProgressBarProps) {
  const palette = usePalette()
  const width = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0))
  return (
    <View
      accessible={false}
      style={[styles.track, { height, backgroundColor: track === 'border' ? palette.border : palette.muted }, style]}
    >
      <View style={[styles.fill, { width: `${width}%`, backgroundColor: color ?? palette.chart1 }]} testID={testID} />
    </View>
  )
}

const styles = StyleSheet.create({
  track: { borderRadius: themeTokens.radius.sm, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: themeTokens.radius.sm },
})
