import { StyleSheet, Text, View } from 'react-native'

import { themeTokens, type Palette } from '@/theme/tokens'


function initialsFrom(source: string): string {
  const trimmed = source.trim()
  if (!trimmed) return '?'
  const namePart = trimmed.split('@')[0] ?? trimmed
  const segments = namePart.split(/[.\s_-]+/).filter(Boolean)
  const initials = segments.slice(0, 2).map((segment) => segment[0]?.toUpperCase() ?? '')
  return initials.join('') || namePart.slice(0, 2).toUpperCase()
}

/** Circular initials avatar, matching the web app's account-menu header. */
export function Avatar({ source, palette, size = 40 }: { source: string; palette: Palette; size?: number }) {
  return (
    <View
      style={[
        styles.circle,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: palette.primarySoft,
        },
      ]}
    >
      <Text allowFontScaling style={[styles.initials, { color: palette.primary, fontSize: size * 0.4 }]}>
        {initialsFrom(source)}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
  initials: {
    fontFamily: themeTokens.typography.roles.interface.fontFamily,
    fontWeight: '700',
  },
})
