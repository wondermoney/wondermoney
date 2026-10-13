import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'
import { BackControl } from '@/components/ui/back-control'

export type Palette = (typeof themeTokens.colors)[keyof typeof themeTokens.colors]

export function SelfAction({
  label,
  onPress,
  palette,
  primary = false,
  disabled = false,
}: {
  label: string
  onPress: () => void | Promise<void>
  palette: Palette
  primary?: boolean
  disabled?: boolean
}) {
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, busy: disabled }}
      disabled={disabled}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={() => void onPress()}
      style={({ pressed }) => [
        styles.action,
        {
          borderColor: primary ? 'transparent' : palette.input,
          backgroundColor: primary ? palette.primary : 'transparent',
        },
        focused && { borderWidth: 2, borderColor: palette.foreground },
        (pressed || disabled) && styles.pressed,
      ]}
    >
      <Text
        allowFontScaling
        style={[
          styles.actionLabel,
          { color: primary ? palette.primaryForeground : palette.foreground },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  )
}

export function SelfLoading({ label, palette, backLabel, onBack }: {
  label: string
  palette: Palette
  backLabel: string
  onBack: () => void
}) {
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <View style={styles.loadingHeader}>
        <BackControl fallback="/more" onPress={onBack} color={palette.primary} />
      </View>
      <View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={styles.loading}>
        {['heading', 'row-one', 'row-two'].map((key) => (
          <View key={key} style={[styles.skeleton, { backgroundColor: palette.muted }]} />
        ))}
      </View>
    </SafeAreaView>
  )
}

export function SelfFailure({
  title,
  message,
  backLabel,
  retryLabel,
  signOutLabel,
  onBack,
  onRetry,
  onLogout,
  palette,
  retryable = true,
}: {
  title: string
  message: string
  backLabel: string
  retryLabel: string
  signOutLabel: string
  onBack: () => void
  onRetry: () => void | Promise<void>
  onLogout: () => void | Promise<void>
  palette: Palette
  retryable?: boolean
}) {
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.centered}>
        <View style={styles.failure}>
          <BackControl fallback="/more" onPress={onBack} color={palette.primary} />
          <View style={[styles.errorMarker, { backgroundColor: palette.destructive }]} />
          <Text accessibilityRole="header" allowFontScaling style={[styles.failureTitle, { color: palette.foreground }]}>
            {title}
          </Text>
          <Text allowFontScaling style={[styles.body, { color: palette.mutedForeground }]}>
            {message}
          </Text>
          <View style={styles.actions}>
            {retryable ? <SelfAction label={retryLabel} onPress={onRetry} palette={palette} primary /> : null}
            <SelfAction label={signOutLabel} onPress={onLogout} palette={palette} />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

export function SelfStaleBanner({ message, retryLabel, refreshing, onRetry, palette }: {
  message: string
  retryLabel: string
  refreshing: boolean
  onRetry: () => void | Promise<void>
  palette: Palette
}) {
  return (
    <View style={[styles.staleBanner, { borderColor: palette.border, backgroundColor: palette.muted }]}>
      <Text accessible accessibilityRole="alert" accessibilityLabel={message} allowFontScaling style={[styles.staleText, { color: palette.foreground }]}>{message}</Text>
      <SelfAction label={retryLabel} onPress={onRetry} disabled={refreshing} palette={palette} />
    </View>
  )
}

export function ReadOnlyRow({ label, value, palette, separated = false }: {
  label: string
  value: string
  palette: Palette
  separated?: boolean
}) {
  return (
    <View
      accessible
      accessibilityLabel={`${label}, ${value}`}
      style={[
        styles.row,
        separated && { borderTopWidth: 1, borderTopColor: palette.border },
      ]}
    >
      <Text allowFontScaling style={[styles.rowLabel, { color: palette.mutedForeground }]}>
        {label}
      </Text>
      <Text allowFontScaling style={[styles.rowValue, { color: palette.foreground }]}>
        {value}
      </Text>
    </View>
  )
}

export const selfStyles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding },
  page: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: themeTokens.layout.blockGap },
  heading: { gap: themeTokens.spacing[2] },
  title: { ...textStyles.title },
  helper: { ...textStyles.body },
  list: { borderWidth: 1, borderRadius: themeTokens.radius.lg, overflow: 'hidden' },
  banner: { ...textStyles.body, borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4] },
})

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  action: { minWidth: themeTokens.touchTarget.minimum, minHeight: themeTokens.touchTarget.minimum, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[4] },
  actionLabel: { ...textStyles.action },
  pressed: { opacity: 0.72 },
  loadingHeader: { padding: themeTokens.layout.screenPadding, alignItems: 'flex-start' },
  loading: { flex: 1, width: '100%', maxWidth: 680, alignSelf: 'center', padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[5] },
  skeleton: { width: '100%', height: 56, borderRadius: themeTokens.radius.md },
  centered: { flexGrow: 1, justifyContent: 'center', padding: themeTokens.layout.screenPadding },
  failure: { width: '100%', maxWidth: 480, alignSelf: 'center', alignItems: 'flex-start', gap: themeTokens.spacing[4] },
  errorMarker: { width: 36, height: 2 },
  failureTitle: { ...textStyles.title },
  body: { ...textStyles.body },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[3] },
  staleBanner: { borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3], alignItems: 'flex-start' },
  staleText: { ...textStyles.body },
  row: { minHeight: themeTokens.layout.rowMinHeight, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[4], paddingVertical: themeTokens.spacing[2] },
  rowLabel: { ...textStyles.meta },
  rowValue: { ...textStyles.body, flexShrink: 1, textAlign: 'right' },
})
