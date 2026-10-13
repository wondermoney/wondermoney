import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

export type PortfolioPalette = (typeof themeTokens.colors)[keyof typeof themeTokens.colors]

export function PortfolioButton({ label, onPress, palette, secondary = false, selected, disabled = false, busy = false }: { label: string; onPress: () => void | Promise<void>; palette: PortfolioPalette; secondary?: boolean; selected?: boolean; disabled?: boolean; busy?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, busy, ...(selected !== undefined ? { selected } : {}) }} disabled={disabled} onPress={() => void onPress()} style={({ pressed }) => [styles.button, { borderColor: secondary ? palette.input : 'transparent', backgroundColor: secondary ? 'transparent' : palette.primary }, (pressed || disabled) && styles.pressed]}><Text allowFontScaling style={[styles.buttonText, { color: secondary ? palette.foreground : palette.primaryForeground }]}>{label}</Text></Pressable>
}
export function PortfolioField({ label, value, onChange, palette, maxLength, multiline = false, disabled = false, required = false, keyboardType, invalid = false, errorText }: { label: string; value: string; onChange: (value: string) => void; palette: PortfolioPalette; maxLength: number; multiline?: boolean; disabled?: boolean; required?: boolean; keyboardType?: 'default' | 'decimal-pad'; invalid?: boolean; errorText?: string }) {
  return <View style={styles.field}><View style={styles.labelRow}><Text style={[styles.label, { color: palette.foreground }]}>{label}{required ? ' *' : ''}</Text><Text style={[styles.counter, { color: palette.mutedForeground }]}>{value.length}/{maxLength}</Text></View><TextInput accessibilityLabel={label} editable={!disabled} keyboardType={keyboardType} maxLength={maxLength} multiline={multiline} value={value} onChangeText={onChange} style={[styles.input, multiline && styles.multiline, { color: palette.foreground, borderColor: invalid ? palette.destructiveText : palette.border, backgroundColor: palette.card }, invalid && styles.inputInvalid]} />{errorText ? <Text accessibilityRole="alert" style={[styles.fieldError, { color: palette.destructiveText }]}>{errorText}</Text> : null}</View>
}
export function PortfolioChoice({ label, visibleLabel, selected, onPress, palette, disabled = false, compact = false }: { label: string; visibleLabel?: string; selected: boolean; onPress: () => void; palette: PortfolioPalette; disabled?: boolean; compact?: boolean }) {
  // Unselected chips carry no border — a dozen-plus currency chips each
  // individually boxed read as a wall of empty containers. Only the
  // selected chip earns a border/fill; unselected ones fall back to a
  // muted background wash (the non-compact variant also has its radio dot
  // to carry the state, so it needs the wash even less).
  return <Pressable accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ checked: selected, disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [compact ? styles.chip : styles.choice, selected ? { borderColor: palette.primary, backgroundColor: palette.primaryWash } : { borderWidth: 0, backgroundColor: palette.muted }, (pressed || disabled) && styles.pressed]}>{compact ? null : <View style={[styles.radio, { borderColor: selected ? palette.primary : palette.mutedForeground }]}>{selected ? <View style={[styles.dot, { backgroundColor: palette.primary }]} /> : null}</View>}<Text numberOfLines={1} style={[styles.choiceText, { color: selected ? palette.primary : palette.foreground }]}>{visibleLabel ?? label}</Text></Pressable>
}
export function PortfolioToggle({ label, helper, value, onToggle, palette, disabled = false }: { label: string; helper?: string; value: boolean; onToggle: (next: boolean) => void; palette: PortfolioPalette; disabled?: boolean }) {
  return <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value, disabled }} disabled={disabled} onPress={() => onToggle(!value)} style={({ pressed }) => [styles.choice, { borderColor: value ? palette.primary : palette.border, backgroundColor: value ? palette.primarySoft : palette.card }, (pressed || disabled) && styles.pressed]}>
    <View style={[styles.switchTrack, { borderColor: value ? palette.primary : palette.mutedForeground, backgroundColor: value ? palette.primary : 'transparent' }]}><View style={[styles.switchThumb, { backgroundColor: value ? palette.background : palette.mutedForeground, alignSelf: value ? 'flex-end' : 'flex-start' }]} /></View>
    <View style={styles.toggleText}><Text style={[styles.choiceText, { color: palette.foreground }]}>{label}</Text>{helper ? <Text style={[styles.counter, { color: palette.mutedForeground }]}>{helper}</Text> : null}</View>
  </Pressable>
}

const styles = StyleSheet.create({
  button: { minHeight: themeTokens.touchTarget.minimum, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[4], paddingVertical: themeTokens.spacing[2] }, buttonText: { ...textStyles.action }, pressed: { opacity: 0.58 },
  field: { gap: themeTokens.spacing[2] }, labelRow: { flexDirection: 'row', justifyContent: 'space-between', gap: themeTokens.spacing[3] }, label: { ...textStyles.bodyStrong, fontWeight: '600' as const }, counter: { ...textStyles.amountSmall }, input: { ...textStyles.body, minHeight: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3], paddingVertical: themeTokens.spacing[2] }, inputInvalid: { borderWidth: 2 }, fieldError: { ...textStyles.amountSmall }, multiline: { minHeight: 120, textAlignVertical: 'top' },
  choice: { minHeight: themeTokens.touchTarget.minimum, flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[3], borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[3] }, radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }, dot: { width: 10, height: 10, borderRadius: 5 }, choiceText: { ...textStyles.body, flexShrink: 1 },
  chip: { minHeight: 34, justifyContent: 'center', borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3] },
  switchTrack: { width: 40, height: 24, borderRadius: 12, borderWidth: 1, padding: 2, justifyContent: 'center' }, switchThumb: { width: 18, height: 18, borderRadius: 9 }, toggleText: { flex: 1, gap: themeTokens.spacing[1] },
})
