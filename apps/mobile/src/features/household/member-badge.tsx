import { useTranslation } from 'react-i18next'
import { StyleSheet, Text as NativeText, View } from 'react-native'

import { Badge } from '@/components/ui/badge'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import type { AttributionMark } from './member-attribution'

const SIZE = 20

/**
 * Whose a row is, in a household of more than one: the member's initial in a small neutral
 * circle (web's person avatar), or a "Shared" badge for the household's joint money. The name is
 * the accessible label; the row's own label should name it too.
 */
export function MemberBadge({ mark, testID = 'member-badge' }: { mark: AttributionMark | null; testID?: string }) {
  const { t } = useTranslation()
  const palette = usePalette()
  if (!mark) return null
  if (mark.kind === 'shared') return <Badge label={t('memberAttribution.shared')} testID={testID} tone="outline" />
  return (
    <View
      accessibilityLabel={t('memberAttribution.attributedTo', { name: mark.name })}
      accessible
      style={[styles.circle, { backgroundColor: palette.muted, borderColor: palette.input }]}
      testID={testID}
    >
      <NativeText allowFontScaling={false} style={[styles.initials, { color: palette.foreground }]}>{mark.initials}</NativeText>
    </View>
  )
}

const styles = StyleSheet.create({
  circle: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  initials: {
    fontFamily: themeTokens.typography.roles.interface.fontFamily,
    fontSize: themeTokens.typography.scale.label.fontSize,
    lineHeight: themeTokens.typography.scale.label.lineHeight,
    fontWeight: '600',
  },
})
