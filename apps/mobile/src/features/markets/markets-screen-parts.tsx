import { useContext, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaInsetsContext, SafeAreaView } from 'react-native-safe-area-context'

import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

export type Palette = (typeof themeTokens.colors)[keyof typeof themeTokens.colors]

/**
 * RAD-238 (slice 1) — shared between markets-search-screen and
 * asset-detail-screen, mirroring self-screen-parts' convention of a
 * per-feature parts file rather than pulling shared chrome in from an
 * unrelated feature (e.g. portfolios).
 */
export function MarketsAction({ label, onPress, palette, primary = false, selected, disabled = false }: {
  label: string
  onPress: () => void
  palette: Palette
  primary?: boolean
  selected?: boolean
  disabled?: boolean
}) {
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, ...(selected !== undefined ? { selected } : {}) }}
      disabled={disabled}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        {
          borderColor: primary ? 'transparent' : selected ? palette.primary : palette.input,
          backgroundColor: primary ? palette.primary : selected ? palette.primaryWash : 'transparent',
        },
        focused && { borderWidth: 2, borderColor: palette.ring },
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text allowFontScaling style={[styles.actionLabel, { color: primary ? palette.primaryForeground : selected ? palette.primary : palette.foreground }]}>
        {label}
      </Text>
    </Pressable>
  )
}

export function MarketsLoading({ label, palette, backLabel, onBack }: {
  label: string
  palette: Palette
  backLabel: string
  onBack: () => void
}) {
  const insets = useContext(SafeAreaInsetsContext)
  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <View style={[styles.loadingHeader, { paddingTop: themeTokens.spacing[6] + (insets?.top ?? 0) }]}>
        <MarketsAction label={backLabel} onPress={onBack} palette={palette} />
      </View>
      <View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={styles.loading}>
        {['heading', 'row-one', 'row-two'].map((key) => (
          <View key={key} style={[styles.skeleton, { backgroundColor: palette.muted }]} />
        ))}
      </View>
    </SafeAreaView>
  )
}

export function MarketsFailure({
  title,
  message,
  backLabel,
  retryLabel,
  onBack,
  onRetry,
  palette,
  retryable = true,
}: {
  title: string
  message: string
  backLabel: string
  retryLabel: string
  onBack: () => void
  onRetry: () => void | Promise<void>
  palette: Palette
  retryable?: boolean
}) {
  const insets = useContext(SafeAreaInsetsContext)
  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={[styles.centered, { paddingTop: themeTokens.spacing[6] + (insets?.top ?? 0) }]}>
        <View style={styles.failure}>
          <MarketsAction label={backLabel} onPress={onBack} palette={palette} />
          <View style={[styles.errorMarker, { backgroundColor: palette.destructive }]} />
          <Text accessibilityRole="header" allowFontScaling style={[styles.failureTitle, { color: palette.foreground }]}>
            {title}
          </Text>
          <Text allowFontScaling style={[styles.body, { color: palette.mutedForeground }]}>
            {message}
          </Text>
          {retryable ? (
            <View style={styles.actions}>
              <MarketsAction label={retryLabel} onPress={onRetry} palette={palette} primary />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

export function ReadOnlyField({ label, value, palette, tone = 'default', separated = false }: {
  label: string
  value: string
  palette: Palette
  tone?: 'default' | 'positive' | 'negative' | 'muted'
  separated?: boolean
}) {
  const color = tone === 'positive'
    ? palette.successText
    : tone === 'negative'
      ? palette.destructiveText
      : tone === 'muted'
        ? palette.mutedForeground
        : palette.foreground
  return (
    <View
      accessible
      accessibilityLabel={`${label}, ${value}`}
      style={[styles.field, separated && { borderTopWidth: 1, borderTopColor: palette.border }]}
    >
      <Text allowFontScaling style={[styles.fieldLabel, { color: palette.mutedForeground }]}>{label}</Text>
      <Text allowFontScaling style={[styles.fieldValue, { color }]}>{value}</Text>
    </View>
  )
}

export const marketsStyles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding },
  page: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: themeTokens.layout.blockGap },
  heading: { gap: themeTokens.spacing[2] },
  title: { ...textStyles.title },
  helper: { ...textStyles.body },
  list: { borderWidth: 1, borderRadius: themeTokens.radius.lg, overflow: 'hidden' },
})

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  action: { minWidth: themeTokens.touchTarget.minimum, minHeight: themeTokens.touchTarget.minimum, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[4] },
  actionLabel: { ...textStyles.action },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.5 },
  loadingHeader: { padding: themeTokens.layout.screenPadding, alignItems: 'flex-start' },
  loading: { flex: 1, width: '100%', maxWidth: 680, alignSelf: 'center', padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[5] },
  skeleton: { width: '100%', height: 56, borderRadius: themeTokens.radius.md },
  centered: { flexGrow: 1, justifyContent: 'center', padding: themeTokens.layout.screenPadding },
  failure: { width: '100%', maxWidth: 480, alignSelf: 'center', alignItems: 'flex-start', gap: themeTokens.spacing[4] },
  errorMarker: { width: 36, height: 2 },
  failureTitle: { ...textStyles.title },
  body: { ...textStyles.body },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[3] },
  field: { minHeight: 68, padding: themeTokens.spacing[4], gap: themeTokens.spacing[2] },
  fieldLabel: { ...textStyles.meta },
  fieldValue: { ...textStyles.amount },
})
