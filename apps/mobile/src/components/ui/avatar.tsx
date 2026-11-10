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

/**
 * Circular initials avatar.
 *
 * `tone="neutral"` is web's person-menu avatar (`bg-muted border-input
 * text-foreground`, 12/600 initials at 32pt); `primary` (default) keeps the
 * older violet-tinted look some screens still use.
 *
 * @param source  a name ("Sofia Martins" → "SM") or an email (handle's first letters).
 */
export function Avatar({
  source,
  palette,
  size = 40,
  tone = 'primary',
}: {
  source: string
  palette: Palette
  size?: number
  tone?: 'primary' | 'neutral'
}) {
  const neutral = tone === 'neutral'
  return (
    <View
      style={[
        styles.circle,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: neutral ? palette.muted : palette.primarySoft,
        },
        neutral && { borderWidth: 1, borderColor: palette.input },
      ]}
    >
      <Text
        allowFontScaling
        style={[
          styles.initials,
          neutral
            ? { color: palette.foreground, fontSize: themeTokens.typography.scale.label.fontSize, fontWeight: '600' }
            : { color: palette.primary, fontSize: size * 0.4 },
        ]}
      >
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
