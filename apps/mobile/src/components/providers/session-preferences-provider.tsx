import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'
import { Appearance, type ColorSchemeName, useColorScheme } from 'react-native'

export type ThemePreference = 'system' | 'light' | 'dark'
export type LanguagePreference = 'device' | 'en' | 'pt-PT' | 'es'
export type SupportedLocale = Exclude<LanguagePreference, 'device'>

type SessionPreferences = Readonly<{
  themePreference: ThemePreference
  languagePreference: LanguagePreference
  resolvedTheme: 'light' | 'dark'
  resolvedLocale: SupportedLocale
  setThemePreference: (value: ThemePreference) => void
  setLanguagePreference: (value: LanguagePreference) => void
}>

const SessionPreferencesContext = createContext<SessionPreferences | null>(null)
export const SYSTEM_COLOR_SCHEME: ColorSchemeName = 'unspecified'

export const resolveLocale = (preference: LanguagePreference, deviceLocale: string): SupportedLocale => {
  if (preference !== 'device') return preference
  const base = deviceLocale.trim().replace(/_/g, '-').toLowerCase().split('-')[0]
  if (base === 'pt') return 'pt-PT'
  if (base === 'es') return 'es'
  return 'en'
}

export const resolveTheme = (
  preference: ThemePreference,
  deviceTheme: ColorSchemeName,
): 'light' | 'dark' => preference === 'system' ? (deviceTheme === 'dark' ? 'dark' : 'light') : preference

export function SessionPreferencesProvider({
  children,
  deviceLocale,
  appearance = Appearance,
  deviceTheme,
}: {
  children: ReactNode
  deviceLocale: string
  appearance?: Pick<typeof Appearance, 'setColorScheme'>
  deviceTheme?: ColorSchemeName
}) {
  const systemDeviceTheme = useColorScheme()
  return <SessionPreferencesValueProvider deviceLocale={deviceLocale} deviceTheme={deviceTheme ?? systemDeviceTheme} appearance={appearance}>{children}</SessionPreferencesValueProvider>
}

function SessionPreferencesValueProvider({
  children,
  deviceLocale,
  deviceTheme,
  appearance,
}: {
  children: ReactNode
  deviceLocale: string
  deviceTheme: ColorSchemeName
  appearance: Pick<typeof Appearance, 'setColorScheme'>
}) {
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>('system')
  const [languagePreference, setLanguagePreference] = useState<LanguagePreference>('device')

  const setThemePreference = useCallback((value: ThemePreference) => {
    // RN 0.86 uses "unspecified" to remove an app override. Apply the native
    // source first so useColorScheme consumers update before context publishes.
    appearance.setColorScheme(value === 'system' ? SYSTEM_COLOR_SCHEME : value)
    setThemePreferenceState(value)
  }, [appearance])

  const value = useMemo<SessionPreferences>(() => ({
    themePreference,
    languagePreference,
    resolvedTheme: resolveTheme(themePreference, deviceTheme),
    resolvedLocale: resolveLocale(languagePreference, deviceLocale),
    setThemePreference,
    setLanguagePreference,
  }), [deviceLocale, deviceTheme, languagePreference, setThemePreference, themePreference])

  return <SessionPreferencesContext.Provider value={value}>{children}</SessionPreferencesContext.Provider>
}

export function useSessionPreferences() {
  const value = useContext(SessionPreferencesContext)
  if (!value) throw new Error('useSessionPreferences must be used within SessionPreferencesProvider')
  return value
}
