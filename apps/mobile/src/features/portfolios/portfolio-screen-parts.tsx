import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'
import { BackControl } from '@/components/ui/back-control'

export type Palette = (typeof themeTokens.colors)[keyof typeof themeTokens.colors]

export function ScreenAction({
  label,
  onPress,
  palette,
  primary = false,
  destructive = false,
  disabled = false,
}: {
  label: string
  onPress: () => void | Promise<unknown>
  palette: Palette
  primary?: boolean
  /** Non-color cue (not relying on border color alone): destructive actions
   * also get the destructive text color, so they read as different from a
   * neutral action like Edit even without color perception. */
  destructive?: boolean
  disabled?: boolean
}) {
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy: disabled, disabled }}
      disabled={disabled}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={() => void onPress()}
      style={({ pressed }) => [
        sharedStyles.action,
        { borderColor: primary ? 'transparent' : destructive ? palette.destructive : palette.input, backgroundColor: primary ? palette.primary : 'transparent' },
        focused && { borderWidth: 2, borderColor: palette.foreground },
        (pressed || disabled) && sharedStyles.pressed,
      ]}
    >
      <Text allowFontScaling style={[sharedStyles.actionLabel, { color: primary ? palette.primaryForeground : destructive ? palette.destructive : palette.foreground }]}>
        {label}
      </Text>
    </Pressable>
  )
}

export function PortfolioFailure({
  title,
  message,
  retryLabel,
  signOutLabel,
  backLabel,
  onRetry,
  onSignOut,
  onBack,
  palette,
  canRetry = true,
}: {
  title: string
  message: string
  retryLabel: string
  signOutLabel: string
  backLabel?: string
  onRetry: () => void | Promise<unknown>
  onSignOut: () => void | Promise<void>
  onBack?: () => void
  palette: Palette
  canRetry?: boolean
}) {
  return (
    <SafeAreaView style={[sharedStyles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={sharedStyles.centered}>
        <View style={sharedStyles.failure}>
          {onBack ? <BackControl fallback="/portfolio" onPress={onBack} color={palette.primary} /> : null}
          <View style={[sharedStyles.errorMarker, { backgroundColor: palette.destructive }]} />
          <Text accessibilityRole="header" allowFontScaling style={[sharedStyles.failureTitle, { color: palette.foreground }]}>{title}</Text>
          <Text allowFontScaling style={[sharedStyles.body, { color: palette.mutedForeground }]}>{message}</Text>
          <View style={sharedStyles.actions}>
            {canRetry ? <ScreenAction label={retryLabel} onPress={onRetry} palette={palette} primary /> : null}
            <ScreenAction label={signOutLabel} onPress={onSignOut} palette={palette} />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

export function PortfolioLoading({ label, palette, onBack, backLabel }: {
  label: string
  palette: Palette
  onBack?: () => void
  backLabel?: string
}) {
  return (
    <SafeAreaView style={[sharedStyles.safeArea, { backgroundColor: palette.background }]}>
      {onBack ? <View style={sharedStyles.loadingBack}><BackControl fallback="/portfolio" onPress={onBack} color={palette.primary} /></View> : null}
      <View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={sharedStyles.loading}>
        {[160, 300, 300, 240].map((width, index) => (
          <View key={index} style={[sharedStyles.skeleton, { width, height: index === 1 ? 112 : 28, backgroundColor: palette.muted }]} />
        ))}
      </View>
    </SafeAreaView>
  )
}

export function Metric({ label, value, palette, tone = 'default' }: {
  label: string
  value: string
  palette: Palette
  tone?: 'default' | 'positive' | 'negative' | 'muted'
}) {
  const color = tone === 'positive'
    ? palette.successText
    : tone === 'negative'
      ? palette.destructiveText
      : tone === 'muted'
        ? palette.mutedForeground
        : palette.foreground
  return (
    <View accessible accessibilityLabel={`${label}, ${value}`} style={sharedStyles.metric}>
      <Text allowFontScaling style={[sharedStyles.metricLabel, { color: palette.mutedForeground }]}>{label}</Text>
      <Text allowFontScaling style={[sharedStyles.metricValue, { color }]}>{value}</Text>
    </View>
  )
}

const sharedStyles = StyleSheet.create({
  safeArea: { flex: 1 },
  action: { minWidth: themeTokens.touchTarget.minimum, minHeight: themeTokens.touchTarget.minimum, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[4] },
  actionLabel: { ...textStyles.action },
  pressed: { opacity: 0.72 },
  centered: { flexGrow: 1, justifyContent: 'center', padding: themeTokens.layout.screenPadding },
  failure: { width: '100%', maxWidth: 480, alignSelf: 'center', alignItems: 'flex-start', gap: themeTokens.spacing[4] },
  errorMarker: { width: 36, height: 2 },
  failureTitle: { ...textStyles.title },
  body: { ...textStyles.body },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[3] },
  loadingBack: { paddingHorizontal: themeTokens.spacing[6], paddingTop: themeTokens.spacing[6], alignItems: 'flex-start' },
  loading: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center', padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[5] },
  skeleton: { maxWidth: '100%', borderRadius: themeTokens.radius.md },
  metric: { flex: 1, minWidth: 128, gap: themeTokens.spacing[1] },
  metricLabel: { ...textStyles.meta },
  metricValue: { ...textStyles.amount },
})
