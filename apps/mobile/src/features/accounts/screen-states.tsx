import { useTranslation } from 'react-i18next'
import { ScrollView, StyleSheet, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

/**
 * Loading, failure and notice states shared by the accounts screens, drawn
 * like web's: skeleton bars in the content's own shape, a plain failure page
 * with Retry, and the quiet register for a notice (hairline, no fill).
 */
export function LoadingState({ label, header }: { label: string; header?: React.ReactNode }) {
  const palette = usePalette()
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <View style={styles.loading}>
        {header}
        <View accessibilityLabel={label} accessibilityRole="progressbar" accessible style={styles.bars}>
          <View style={[styles.bar, styles.barTitle, { backgroundColor: palette.muted }]} />
          <View style={[styles.bar, styles.barFigure, { backgroundColor: palette.muted }]} />
          {[0, 1, 2].map((index) => <View key={index} style={[styles.bar, styles.barRow, { backgroundColor: palette.muted }]} />)}
        </View>
      </View>
    </SafeAreaView>
  )
}

export function FailureState({ title, message, onRetry, onLogout, header }: {
  title: string
  message: string
  onRetry?: () => void | Promise<void>
  onLogout?: () => void | Promise<void>
  header?: React.ReactNode
}) {
  const { t } = useTranslation()
  const palette = usePalette()
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.failureContent}>
        {header}
        <View style={styles.failure}>
          <Text accessibilityRole="header" variant="title">{title}</Text>
          <Text tone="muted" variant="body">{message}</Text>
          <View style={styles.actions}>
            {onRetry ? <Button label={t('common.retry')} onPress={onRetry} /> : null}
            {onLogout ? <Button label={t('common.signOut')} onPress={onLogout} variant="secondary" /> : null}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

/** A section's own loading bar or "could not load" line, so one section failing leaves the rest. */
export function SectionMessage({ loading = false, message }: { loading?: boolean; message?: string }) {
  const { t } = useTranslation()
  const palette = usePalette()
  if (loading) {
    return (
      <View accessibilityLabel={t('loading')} accessibilityRole="progressbar" accessible style={styles.sectionLoading}>
        <View style={[styles.bar, styles.barRow, { backgroundColor: palette.muted }]} />
        <View style={[styles.bar, styles.barShort, { backgroundColor: palette.muted }]} />
      </View>
    )
  }
  return <Text style={styles.sectionError} tone="muted" variant="meta">{message ?? t('accountsOverview.sectionUnavailable')}</Text>
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  loading: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center', padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[6] },
  bars: { gap: themeTokens.spacing[4] },
  bar: { borderRadius: themeTokens.radius.sm, maxWidth: '100%' },
  barTitle: { width: 220, height: 32 },
  barFigure: { width: 300, height: 56, marginTop: themeTokens.spacing[6] },
  barRow: { width: '100%', height: 24 },
  barShort: { width: '60%', height: 24 },
  failureContent: { flexGrow: 1, padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[6] },
  failure: { flexGrow: 1, justifyContent: 'center', width: '100%', maxWidth: 480, alignSelf: 'center', gap: themeTokens.spacing[4] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[3] },
  sectionLoading: { gap: themeTokens.spacing[3] },
  sectionError: { paddingVertical: themeTokens.spacing[4] },
})
