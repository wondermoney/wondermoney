import { StyleSheet } from 'react-native'

type Insets = { top?: number; bottom?: number; left?: number; right?: number }

/**
 * The height a control offers the finger: its drawn height plus its vertical
 * `hitSlop`. Controls draw at web's 40pt (or 36/32) and make up the 44pt floor
 * with slop, so asserting the drawn `minHeight` alone is the wrong measure.
 */
export function touchHeight(element: { props: { style?: unknown; hitSlop?: number | Insets | null } }): number {
  const style = StyleSheet.flatten(element.props.style as never) as { minHeight?: number; height?: number } | undefined
  const drawn = Number(style?.minHeight ?? style?.height ?? 0)
  const slop = element.props.hitSlop
  if (typeof slop === 'number') return drawn + slop * 2
  return drawn + (slop?.top ?? 0) + (slop?.bottom ?? 0)
}
