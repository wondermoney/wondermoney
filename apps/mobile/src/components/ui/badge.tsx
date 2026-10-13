import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

export type BadgeTone = 'neutral' | 'destructive' | 'warning' | 'info' | 'success'

/**
 * Status is a word in a badge, never a colour alone.
 *
 * The label is required and cannot be empty — a bare coloured dot is not a
 * status, it is a puzzle. The badge belongs inline with the title it describes,
 * not in a trailing column.
 *
 * Badges look heterogeneous in a row and that is the accepted outcome: in the
 * light half `destructive` and `info` are dark fills with near-white text while
 * `warning` and `success` are light fills with dark ink, because that is where
 * each hue reaches 4.5:1 in gamut. Two uniform alternatives were measured on
 * the web half and both failed the floor.
 */
export function Badge({ label, tone = 'neutral', testID }: { label: string; tone?: BadgeTone; testID?: string }) {
  const palette = usePalette()

  const { background, color } = {
    neutral: { background: palette.muted, color: palette.mutedForeground },
    destructive: { background: palette.destructive, color: palette.destructiveForeground },
    warning: { background: palette.warning, color: palette.warningForeground },
    info: { background: palette.info, color: palette.infoForeground },
    success: { background: palette.success, color: palette.successForeground },
  }[tone]

  return (
    <View style={[styles.badge, { backgroundColor: background }]} testID={testID}>
      <Text variant="label" style={[styles.label, { color }]}>
        {label}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: themeTokens.radius.sm,
    paddingHorizontal: themeTokens.spacing[2],
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  label: { fontWeight: '500' },
})
