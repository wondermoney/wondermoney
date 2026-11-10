import { Children, isValidElement } from 'react'
import { Pressable, StyleSheet, Text as RNText, View } from 'react-native'

import { FORM_ROW_HEIGHT } from '@/components/ui/form-row'
import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'
import { usePalette } from '@/theme/use-palette'

export type PortfolioPalette = (typeof themeTokens.colors)[keyof typeof themeTokens.colors]

export function PortfolioButton({ label, onPress, palette, secondary = false, selected, disabled = false, busy = false }: { label: string; onPress: () => void | Promise<void>; palette: PortfolioPalette; secondary?: boolean; selected?: boolean; disabled?: boolean; busy?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, busy, ...(selected !== undefined ? { selected } : {}) }} disabled={disabled} onPress={() => void onPress()} style={({ pressed }) => [styles.button, { borderColor: secondary ? palette.input : 'transparent', backgroundColor: secondary ? 'transparent' : palette.primary }, (pressed || disabled) && styles.pressed]}><RNText allowFontScaling style={[styles.buttonText, { color: secondary ? palette.foreground : palette.primaryForeground }]}>{label}</RNText></Pressable>
}

/** A frozen review: one subtle rounded list, label left and value right, hairlines between. */
export function PortfolioReviewList({ children }: { children: React.ReactNode }) {
  const palette = usePalette()
  const rows = Children.toArray(children).filter(isValidElement)
  return (
    <View style={[styles.reviewList, { borderColor: palette.border }]}>
      {rows.map((row, index) => (
        <View key={row.key ?? index} style={index > 0 ? { borderTopWidth: 1, borderTopColor: palette.border } : null}>{row}</View>
      ))}
    </View>
  )
}

/** One reviewed value. Its accessible name is "Label: value". */
export function PortfolioReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={styles.reviewRow}>
      <Text style={styles.reviewLabel} variant="body">{label}</Text>
      <Text style={styles.reviewValue} variant="body">{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  button: { minHeight: themeTokens.touchTarget.minimum, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[4], paddingVertical: themeTokens.spacing[2] }, buttonText: { ...textStyles.action }, pressed: { opacity: 0.58 },
  reviewList: { borderWidth: 1, borderRadius: themeTokens.radius.xl },
  reviewRow: { minHeight: FORM_ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[4], paddingHorizontal: themeTokens.spacing[4], paddingVertical: themeTokens.spacing[3] },
  reviewLabel: { flexShrink: 0, maxWidth: '50%' },
  reviewValue: { flexShrink: 1, textAlign: 'right' },
})
