import type { TextStyle } from 'react-native'

import { themeTokens } from '@/theme/tokens'

export type TypeRole = keyof typeof themeTokens.typography.scale

/**
 * The exact shape of a scale entry.
 *
 * Deliberately narrower than `TextStyle`: spreading a full `TextStyle` into a
 * style object drags every optional text property along with it, and TypeScript
 * then refuses the result wherever a `ViewStyle` is expected — even though the
 * spread only ever contributed five keys.
 */
export type ScaleStyle = {
  fontFamily: string
  fontSize: number
  lineHeight: number
  letterSpacing: number
  fontWeight: TextStyle['fontWeight']
}

/**
 * The named scale as plain style objects.
 *
 * Deliberately **not** `StyleSheet.create`. These exist to be spread into other
 * style objects (`{ ...textStyles.meta, marginTop: 4 }`), and a registered
 * style is not reliably spreadable across RN versions — it has been an opaque
 * handle before now and could be again. A plain frozen object always spreads.
 *
 * Lives in the theme rather than beside the `Text` component so a screen's
 * `StyleSheet` can reach the scale without importing a component.
 */
export const textStyles = Object.freeze(
  Object.fromEntries(
    (Object.keys(themeTokens.typography.scale) as TypeRole[]).map((role) => {
      const scale = themeTokens.typography.scale[role]
      return [
        role,
        Object.freeze({
          fontFamily: scale.fontFamily,
          fontSize: scale.fontSize,
          lineHeight: scale.lineHeight,
          letterSpacing: scale.letterSpacing,
          fontWeight: scale.fontWeight as TextStyle['fontWeight'],
        }),
      ]
    }),
  ) as Record<TypeRole, ScaleStyle>,
)

/** The same thing as a function, for a `TextInput`'s own `style` or a chart label. */
export function textStyle(role: TypeRole): ScaleStyle {
  return textStyles[role]
}
