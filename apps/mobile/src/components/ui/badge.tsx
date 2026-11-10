import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/ui/text'
import { themeTokens, type Palette } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

/**
 * Web's badge variants (`components/ui/badge.tsx`). `outline` is the plain
 * status chip web uses for "Active" / "Pay off debt"; `neutral` is the older
 * mobile name for web's `muted`.
 */
export type BadgeTone =
  | 'outline'
  | 'neutral'
  | 'muted'
  | 'secondary'
  | 'primary'
  | 'destructive'
  | 'warning'
  | 'info'
  | 'success'

/**
 * Status is a word in a badge, never a colour alone.
 *
 * Mirrors web's `<Badge>`: 4pt radius, 1pt border, `px-2 py-0.5`, 12/600.
 * Fills are solid (never washed) because each `-foreground` is contrast-tested
 * against its solid fill. The badge sits inline with the title it describes.
 *
 * @param label  required, non-empty: a bare coloured dot is not a status.
 * @param tone   defaults to `neutral` (web `muted`); status chips like "Active" want `outline`.
 */
export function Badge({ label, tone = 'neutral', testID }: { label: string; tone?: BadgeTone; testID?: string }) {
  const palette = usePalette()
  const { background, color, border } = surfaceFor(tone, palette)

  return (
    <View style={[styles.badge, { backgroundColor: background, borderColor: border }]} testID={testID}>
      <Text variant="label" style={[styles.label, { color }]}>
        {label}
      </Text>
    </View>
  )
}

function surfaceFor(tone: BadgeTone, palette: Palette) {
  switch (tone) {
    case 'outline':
      return { background: 'transparent', color: palette.foreground, border: palette.border }
    case 'neutral':
    case 'muted':
      return { background: palette.muted, color: palette.mutedForeground, border: palette.border }
    case 'secondary':
      return { background: palette.secondary, color: palette.secondaryForeground, border: palette.input }
    case 'primary':
      return { background: palette.primary, color: palette.primaryForeground, border: 'transparent' }
    case 'destructive':
      return { background: palette.destructive, color: palette.destructiveForeground, border: 'transparent' }
    case 'warning':
      return { background: palette.warning, color: palette.warningForeground, border: 'transparent' }
    case 'info':
      return { background: palette.info, color: palette.infoForeground, border: 'transparent' }
    case 'success':
      return { background: palette.success, color: palette.successForeground, border: 'transparent' }
  }
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: themeTokens.radius.sm,
    borderWidth: 1,
    paddingHorizontal: themeTokens.spacing[2],
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  label: { fontWeight: '600' },
})
