import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Appearance, ScrollView, StyleSheet, Text, View } from 'react-native'
import * as SplashScreen from 'expo-splash-screen'

import { captureError } from '@/lib/telemetry/error-reporting'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

/**
 * The app previously had no error boundary anywhere in its tree: an uncaught
 * render-time throw unmounted everything with no fallback UI and no signal,
 * appearing as a blank/frozen screen. This is the last line of defense — it
 * always renders *something* and always reports through the existing
 * `captureError` boundary, whether or not Sentry is active for this build.
 *
 * Deliberately minimal: no retry/reload affordance (there is no reliable one
 * without `expo-updates`), no i18n (translations may not be safe to trust at
 * this point), and no design-system *components* — if one of them is what
 * threw, rendering it here throws again.
 *
 * Static token values are a different matter and are used: they are frozen
 * data, they cannot throw, and without them this screen was light-only and
 * ignored the theme entirely.
 */
type State = { error: Error | null }

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    captureError(error)
    // The catch can fire before `onReady` ever hides the native splash (e.g. a
    // throw during initial provider setup), which would otherwise leave this
    // fallback rendered but invisible underneath it.
    void SplashScreen.hideAsync()
    if (__DEV__) console.error('AppErrorBoundary caught:', error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    // `Appearance` rather than `useColorScheme`, because this is a class and
    // must stay one: a hook here would mean a function component, and the
    // boundary has to survive whatever just threw. Reading the two halves'
    // committed values is still hook-free and still cannot throw.
    const palette = themeTokens.colors[Appearance.getColorScheme() === 'dark' ? 'dark' : 'light']
    return (
      <View style={[styles.container, { backgroundColor: palette.background }]}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Text style={[styles.title, { color: palette.foreground }]}>Something went wrong</Text>
          <Text style={[styles.message, { color: palette.foreground }]}>{error.message}</Text>
          {__DEV__ && error.stack ? (
            <Text style={[styles.stack, { color: palette.mutedForeground }]}>{error.stack}</Text>
          ) : null}
        </ScrollView>
      </View>
    )
  }
}

/** Enough to clear the notch on every device this ships to. */
const STATUS_BAR_FALLBACK = 60

const styles = StyleSheet.create({
  // Stands in for the safe-area inset: this renders before the provider
  // that would supply a real one exists.
  container: { flex: 1, paddingTop: STATUS_BAR_FALLBACK },
  scrollContent: { padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[3] },
  title: { ...textStyles.section, fontWeight: '700' as const },
  message: { ...textStyles.body },
  stack: { ...textStyles.label },
})
