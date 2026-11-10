import { ScrollView, StyleSheet, View } from 'react-native'

import { BackControl } from '@/components/ui/back-control'
import { Button } from '@/components/ui/button'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Text } from '@/components/ui/text'
import { SettingsLoading, SettingsNotice, SettingsPage, type SettingsSectionId } from '@/features/more/settings-ui'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

export type Palette = (typeof themeTokens.colors)[keyof typeof themeTokens.colors]

/** A settings-page action: web's `Button` (primary, or outline). */
export function SelfAction({
  label,
  onPress,
  primary = false,
  disabled = false,
}: {
  label: string
  onPress: () => void | Promise<void>
  /** @deprecated read from the colour scheme now; accepted and ignored. */
  palette?: Palette
  primary?: boolean
  disabled?: boolean
}) {
  return <Button disabled={disabled} label={label} onPress={() => void onPress()} variant={primary ? 'primary' : 'outline'} />
}

export function SelfLoading({ label, palette, backLabel, onBack, section }: {
  label: string
  palette: Palette
  backLabel: string
  onBack: () => void
  /** Inside Settings: draw the Settings title and section select above the placeholder. */
  section?: SettingsSectionId
}) {
  if (section) {
    return (
      <SettingsPage backLabel={backLabel} onBack={onBack} section={section}>
        <SettingsLoading label={label} />
      </SettingsPage>
    )
  }
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <View style={styles.loadingHeader}>
        <BackControl fallback="/more" label={backLabel} onPress={onBack} />
      </View>
      <View style={styles.loading}>
        <SettingsLoading label={label} />
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
  section,
}: {
  section?: SettingsSectionId
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
  const body = (
    <View style={styles.failure}>
      <Text accessibilityRole="header" variant="section">{title}</Text>
      <Text tone="muted" variant="meta">{message}</Text>
      <View style={styles.actions}>
        {retryable ? <SelfAction label={retryLabel} onPress={onRetry} primary /> : null}
        <SelfAction label={signOutLabel} onPress={onLogout} />
      </View>
    </View>
  )
  if (section) {
    return <SettingsPage backLabel={backLabel} onBack={onBack} section={section}>{body}</SettingsPage>
  }
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.centered}>
        <View style={styles.failurePage}>
          <BackControl fallback="/more" label={backLabel} onPress={onBack} />
          {body}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

export function SelfStaleBanner({ message, retryLabel, refreshing, onRetry }: {
  message: string
  retryLabel: string
  refreshing: boolean
  onRetry: () => void | Promise<void>
  /** @deprecated read from the colour scheme now; accepted and ignored. */
  palette?: Palette
}) {
  return (
    <SettingsNotice
      action={<Button label={retryLabel} loading={refreshing} onPress={() => void onRetry()} size="sm" variant="outline" />}
      alert
      message={message}
    />
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
  loading: { flex: 1, width: '100%', maxWidth: 680, alignSelf: 'center', padding: themeTokens.layout.screenPadding },
  skeleton: { width: '100%', height: 56, borderRadius: themeTokens.radius.md },
  centered: { flexGrow: 1, justifyContent: 'center', padding: themeTokens.layout.screenPadding },
  failure: { alignItems: 'flex-start', gap: themeTokens.spacing[3] },
  failurePage: { width: '100%', maxWidth: 480, alignSelf: 'center', alignItems: 'flex-start', gap: themeTokens.spacing[6] },
  errorMarker: { width: 36, height: 2 },
  failureTitle: { ...textStyles.title },
  body: { ...textStyles.body },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[3] },
  staleBanner: { borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3], alignItems: 'flex-start' },
  staleText: { ...textStyles.body },
  row: { minHeight: themeTokens.layout.rowMinHeight, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[4], paddingHorizontal: themeTokens.spacing[3], paddingVertical: themeTokens.spacing[2] },
  rowLabel: { ...textStyles.meta },
  rowValue: { ...textStyles.body, flexShrink: 1, textAlign: 'right' },
})
