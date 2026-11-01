import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native'

import { themeTokens } from '@/theme/tokens'
import type { TypeRole } from '@/theme/typography'
import { usePalette } from '@/theme/use-palette'

type Role = TypeRole

/**
 * Semantic colour roles a piece of text may take. Deliberately not the whole
 * palette: an amount is `default`, a status is `destructive`/`success`/etc.,
 * and there is no role for "green because it is a positive number" because
 * that is not a thing this system does (`DESIGN.md`'s Do's and Don'ts).
 */
type Tone = 'default' | 'muted' | 'primary' | 'destructive' | 'warning' | 'info' | 'success' | 'onPrimary' | 'onFill'

export type TextProps = RNTextProps & {
  variant?: Role
  tone?: Tone
  /** Right-align a figure so decimal points stack down a column. */
  align?: TextStyle['textAlign']
}

/**
 * The only `Text` screens should reach for.
 *
 * Before this existed, 23 distinct literal `fontSize` values were spread across
 * the app and each one carried its own hand-picked `lineHeight`, `fontWeight`
 * and `fontFamily` — which is how a page title ended up rendered five different
 * ways. Passing a role instead of four properties makes the scale the only way
 * to size text, and makes an off-scale size a visible act rather than a typo.
 *
 * `allowFontScaling` defaults on and is not overridable to `false` here: the
 * system requires that long `pt`/`es` strings and a 200% type scale reflow.
 */
export function Text({ variant = 'body', tone = 'default', align, style, ...rest }: TextProps) {
  const palette = usePalette()
  const scale = themeTokens.typography.scale[variant]

  const color = {
    default: palette.foreground,
    muted: palette.mutedForeground,
    primary: palette.primary,
    destructive: palette.destructiveText,
    warning: palette.warningText,
    info: palette.infoText,
    success: palette.successText,
    onPrimary: palette.primaryForeground,
    onFill: palette.background,
  }[tone]

  return (
    <RNText
      allowFontScaling
      {...rest}
      style={[
        {
          fontFamily: scale.fontFamily,
          fontSize: scale.fontSize,
          lineHeight: scale.lineHeight,
          letterSpacing: scale.letterSpacing,
          fontWeight: scale.fontWeight as TextStyle['fontWeight'],
          color,
        },
        align ? { textAlign: align } : null,
        style,
      ]}
    />
  )
}
