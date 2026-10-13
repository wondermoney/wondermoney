import { getLocales } from 'expo-localization'
import { useFonts } from 'expo-font'
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppState, Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { AppErrorBoundary } from '@/components/app-error-boundary'
import { AppLockProvider } from '@/components/providers/app-lock-provider'
import { AppProviders } from '@/components/providers/app-providers'
import { PasswordRecoveryProvider } from '@/components/providers/password-recovery-provider'
import { ProductRuntimeProvider } from '@/components/providers/product-runtime-provider'
import { ServerSwitchProvider } from '@/components/providers/server-switch-provider'
import { SessionPreferencesProvider, useSessionPreferences } from '@/components/providers/session-preferences-provider'
import { RootRouter } from '@/features/root/root-router'
import {
  createLiveAppDependencies,
  type LiveAppDependenciesResult,
} from '@/lib/runtime/live-app-dependencies'
import { readSavedServerUrl, saveServerUrl } from '@/lib/server/server-connection'
import { initAnalytics, resetAnalytics } from '@/lib/telemetry/analytics'
import { initErrorReporting, resetErrorReporting } from '@/lib/telemetry/error-reporting'
import { createPostHogAnalyticsClient } from '@/lib/telemetry/posthog-analytics-client'
import { createSentryErrorClient } from '@/lib/telemetry/sentry-error-client'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

SplashScreen.preventAutoHideAsync()

const appStatePort = {
  get currentState() {
    return AppState.currentState
  },
  addEventListener: (_event: 'change', callback: (state: string) => void) => AppState.addEventListener('change', callback),
}

const environment = {
  EXPO_PUBLIC_APP_ENV: process.env.EXPO_PUBLIC_APP_ENV,
  EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
  EXPO_PUBLIC_POSTHOG_KEY: process.env.EXPO_PUBLIC_POSTHOG_KEY,
}

// The server the user chose on the sign-in screen, if any, replaces the build default.
const createDependencies = () => createLiveAppDependencies(environment, appStatePort, globalThis.fetch, readSavedServerUrl())
const liveDependencies = createDependencies()

// RAD-518 — one install, from the validated public environment, before any
// screen mounts. An unavailable/invalid environment leaves the boundary in its
// inert state and never constructs a PostHog client; so does any environment
// the telemetry ADR has not approved for capture (see analytics.ts).
// Telemetry belongs to the build's default server: it stays off on anyone else's.
const telemetryAllowed = liveDependencies.status === 'available' && liveDependencies.dependencies.usesDefaultServer

initAnalytics({
  config: telemetryAllowed && liveDependencies.status === 'available' ? liveDependencies.dependencies.analytics : undefined,
  createClient: createPostHogAnalyticsClient,
})

// RAD-517 — same shape, same gate, same point in startup as analytics above:
// validated environment → config → init, before any screen mounts. An
// unavailable/invalid environment, or one the Sentry telemetry ADR has not
// approved, never reaches `Sentry.init` at all — so no global error handlers are
// installed, no native SDK starts, and no envelope cache is written.
//
// Nothing else in the app calls Sentry: uncaught render errors, unhandled
// promise rejections and native crashes are picked up by the SDK's own default
// handlers once this runs, and everything deliberate goes through
// `captureError`. See `sentry-error-client.ts` for why `Sentry.wrap` is not used.
initErrorReporting({
  config: telemetryAllowed && liveDependencies.status === 'available' ? liveDependencies.dependencies.errorReporting : undefined,
  createClient: createSentryErrorClient,
})

const hideNativeSplash = () => {
  void SplashScreen.hideAsync()
}

export default function RootLayout() {
  const deviceLocale = getLocales()[0]?.languageTag ?? 'en'
  const [fontsLoaded, fontError] = useFonts({
    Geist: require('../../assets/fonts/Geist-Variable.ttf'),
    GeistMono: require('../../assets/fonts/GeistMono-Variable.ttf'),
  })

  // Keep the native splash visible until the font files have either loaded or
  // failed. This prevents the first rendered frame from using a system font.
  // A font failure is allowed to continue so the existing startup boundary
  // can still own the splash and surface configuration failures as before.
  if (!fontsLoaded && !fontError) return null

  return (
    <AppErrorBoundary>
      <SessionPreferencesProvider deviceLocale={deviceLocale}>
        <RootTheme />
      </SessionPreferencesProvider>
    </AppErrorBoundary>
  )
}

function RootTheme() {
  const { resolvedTheme, resolvedLocale } = useSessionPreferences()
  return (
    <ThemeProvider value={resolvedTheme === 'dark' ? DarkTheme : DefaultTheme}>
      <SafeAreaProvider>
        <RootRuntime dependencies={liveDependencies} locale={resolvedLocale} />
      </SafeAreaProvider>
    </ThemeProvider>
  )
}

export function RootRuntime({
  dependencies,
  locale,
}: {
  dependencies: LiveAppDependenciesResult
  locale: string
}) {
  const [currentDependencies, setCurrentDependencies] = useState(dependencies)
  useEffect(() => {
    if (currentDependencies.status === 'unavailable') hideNativeSplash()
  }, [currentDependencies.status])

  const retryStartup = useCallback(() => {
    setCurrentDependencies(createDependencies())
  }, [])

  const switchServer = useCallback(async (url: string | null) => {
    await saveServerUrl(url)
    const next = createDependencies()
    if (next.status !== 'available' || !next.dependencies.usesDefaultServer) {
      resetAnalytics()
      resetErrorReporting()
    }
    setCurrentDependencies(next)
  }, [])

  const serverSwitch = useMemo(
    () => currentDependencies.status === 'available'
      ? {
          apiBaseUrl: currentDependencies.dependencies.apiBaseUrl,
          switchServer,
          usesDefaultServer: currentDependencies.dependencies.usesDefaultServer,
        }
      : null,
    [currentDependencies, switchServer],
  )

  return currentDependencies.status === 'available' && serverSwitch ? (
    <ServerSwitchProvider value={serverSwitch}>
       {/* Keyed on the server so every provider rebuilds its runtime when it changes. */}
       <AppProviders
       key={serverSwitch.apiBaseUrl}
       locale={locale}
       createSessionLifecycle={currentDependencies.dependencies.createSessionLifecycle}
      onReady={hideNativeSplash}
    >
       <PasswordRecoveryProvider adapter={currentDependencies.dependencies.passwordRecovery}>
        <ProductRuntimeProvider
           auth={currentDependencies.dependencies.auth}
           transport={currentDependencies.dependencies.transport}
           createRuntime={currentDependencies.dependencies.runtimeFactory}
        >
          <AppLockProvider appState={appStatePort}>
            <RootRouter />
          </AppLockProvider>
        </ProductRuntimeProvider>
      </PasswordRecoveryProvider>
    </AppProviders>
    </ServerSwitchProvider>
  ) : (
    <StartupFailure onRetry={retryStartup} />
  )
}

/**
 * Shown when configuration is unavailable, so it renders before anything in the
 * app has loaded. It was hardcoded near-black-on-white and ignored the theme;
 * the tokens are static data and available this early, so there is no reason
 * for it not to match the rest of the app.
 */
function StartupFailure({ onRetry }: { onRetry: () => void }) {
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  return (
    <View style={[startupStyles.container, { backgroundColor: palette.background }]}>
      <Text style={[startupStyles.title, { color: palette.foreground }]}>WonderMoney could not start</Text>
      <Text style={[startupStyles.message, { color: palette.mutedForeground }]}>
        The app configuration is unavailable. Check your connection or app configuration, then try again.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        style={[startupStyles.button, { backgroundColor: palette.primary }]}
      >
        <Text style={[startupStyles.buttonText, { color: palette.primaryForeground }]}>Retry startup</Text>
      </Pressable>
    </View>
  )
}

const startupStyles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: themeTokens.spacing[6] },
  title: { ...textStyles.section, fontWeight: '700' as const, marginBottom: themeTokens.spacing[3] },
  message: { ...textStyles.body, marginBottom: themeTokens.spacing[5] },
  button: {
    alignSelf: 'flex-start',
    minHeight: themeTokens.touchTarget.minimum,
    justifyContent: 'center',
    borderRadius: themeTokens.radius.md,
    paddingHorizontal: themeTokens.spacing[4],
  },
  buttonText: { ...textStyles.action },
})
