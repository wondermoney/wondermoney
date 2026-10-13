import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { Pressable, StyleSheet, Text } from 'react-native'
import { useRouter, type Href } from 'expo-router'
import { SymbolView } from 'expo-symbols'

import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'
import { usePalette } from '@/theme/use-palette'

/** A single, predictable back affordance for pushed product routes. */
export function BackControl({ fallback, onPress, color, disabled = false, label }: { fallback: Href; onPress?: () => void; color?: string; disabled?: boolean; label?: string }) {
  const router = useRouter()
  const { t } = useTranslation()
  const palette = usePalette()
  const [focused, setFocused] = useState(false)
  const back = () => {
    if (disabled) return
    if (onPress) return onPress()
    if (router.canGoBack()) router.back()
    else router.replace(fallback)
  }
  // Screens that can name their destination should: "Back to More" is a
  // better announcement than "Back", and it costs nothing here.
  const accessibleLabel = label ?? t('common.back')
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibleLabel} accessibilityState={{ disabled, busy: false }} disabled={disabled} onBlur={() => setFocused(false)} onFocus={() => setFocused(true)} onPress={back} style={({ pressed }) => [styles.control, focused && { borderWidth: 2, borderColor: palette.ring }, pressed && styles.pressed, disabled && styles.disabled]}>
      <SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={18} tintColor={color} />
      <Text allowFontScaling style={[styles.label, { color }]}>{accessibleLabel}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  control: { alignSelf: 'flex-start', minHeight: 48, minWidth: 48, flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[1], paddingHorizontal: themeTokens.spacing[1] },
  label: { ...textStyles.bodyStrong, fontWeight: '600' as const },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
})
