import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Appearance, type ColorSchemeName, useColorScheme } from 'react-native'

import { type PreferenceStorage, secureStorePreferenceStorage } from '@/features/preferences/preference-storage'

export type ThemePreference = 'system' | 'light' | 'dark'
export type LanguagePreference = 'device' | 'en' | 'pt-PT' | 'es'
export type SupportedLocale = Exclude<LanguagePreference, 'device'>

type SessionPreferences = Readonly<{
  themePreference: ThemePreference
  languagePreference: LanguagePreference
  resolvedTheme: 'light' | 'dark'
  resolvedLocale: SupportedLocale
  /** Amounts are masked on this device (`usePrivacyMode`). */
  privacyMode: boolean
  setThemePreference: (value: ThemePreference) => void
  setLanguagePreference: (value: LanguagePreference) => void
  setPrivacyMode: (value: boolean) => void
}>

const SessionPreferencesContext = createContext<SessionPreferences | null>(null)
// React Native exports the override type only as setColorScheme's parameter.
export const SYSTEM_COLOR_SCHEME: Parameters<typeof Appearance.setColorScheme>[0] = 'unspecified'

export const resolveLocale = (preference: LanguagePreference, deviceLocale: string): SupportedLocale => {
  if (preference !== 'device') return preference
  const base = deviceLocale.trim().replace(/_/g, '-').toLowerCase().split('-')[0]
  if (base === 'pt') return 'pt-PT'
  if (base === 'es') return 'es'
  return 'en'
}

export const resolveTheme = (
  preference: ThemePreference,
  deviceTheme: ColorSchemeName | null,
): 'light' | 'dark' => preference === 'system' ? (deviceTheme === 'dark' ? 'dark' : 'light') : preference

export function SessionPreferencesProvider({
  children,
  deviceLocale,
  appearance = Appearance,
  deviceTheme,
  storage = secureStorePreferenceStorage,
}: {
  children: ReactNode
  deviceLocale: string
  appearance?: Pick<typeof Appearance, 'setColorScheme'>
  deviceTheme?: ColorSchemeName | null
  /** Where the device remembers the choices across restarts. */
  storage?: PreferenceStorage
}) {
  const systemDeviceTheme = useColorScheme()
  return <SessionPreferencesValueProvider deviceLocale={deviceLocale} deviceTheme={deviceTheme ?? systemDeviceTheme} appearance={appearance} storage={storage}>{children}</SessionPreferencesValueProvider>
}

function SessionPreferencesValueProvider({
  children,
  deviceLocale,
  deviceTheme,
  appearance,
  storage,
}: {
  children: ReactNode
  deviceLocale: string
  deviceTheme: ColorSchemeName | null
  appearance: Pick<typeof Appearance, 'setColorScheme'>
  storage: PreferenceStorage
}) {
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>('system')
  const [languagePreference, setLanguagePreferenceState] = useState<LanguagePreference>('device')
  const [privacyMode, setPrivacyModeState] = useState(false)
  // A choice made before the stored values arrive wins over them.
  const chosen = useRef({ theme: false, language: false, privacy: false })

  const applyTheme = useCallback((value: ThemePreference) => {
    // React Native uses "unspecified" to remove an app override. Apply the native
    // source first so useColorScheme consumers update before context publishes.
    appearance.setColorScheme(value === 'system' ? SYSTEM_COLOR_SCHEME : value)
    setThemePreferenceState(value)
  }, [appearance])

  useEffect(() => {
    let active = true
    storage.load().then((stored) => {
      if (!active) return
      if (stored.theme && !chosen.current.theme) applyTheme(stored.theme)
      if (stored.language && !chosen.current.language) setLanguagePreferenceState(stored.language)
      if (typeof stored.privacyMode === 'boolean' && !chosen.current.privacy) setPrivacyModeState(stored.privacyMode)
    }, () => undefined)
    return () => { active = false }
  }, [applyTheme, storage])

  const setThemePreference = useCallback((value: ThemePreference) => {
    chosen.current.theme = true
    applyTheme(value)
    void storage.saveTheme(value)
  }, [applyTheme, storage])

  const setLanguagePreference = useCallback((value: LanguagePreference) => {
    chosen.current.language = true
    setLanguagePreferenceState(value)
    void storage.saveLanguage(value)
  }, [storage])

  const setPrivacyMode = useCallback((value: boolean) => {
    chosen.current.privacy = true
    setPrivacyModeState(value)
    void storage.savePrivacyMode(value)
  }, [storage])

  const value = useMemo<SessionPreferences>(() => ({
    themePreference,
    languagePreference,
    resolvedTheme: resolveTheme(themePreference, deviceTheme),
    resolvedLocale: resolveLocale(languagePreference, deviceLocale),
    privacyMode,
    setThemePreference,
    setLanguagePreference,
    setPrivacyMode,
  }), [deviceLocale, deviceTheme, languagePreference, privacyMode, setLanguagePreference, setPrivacyMode, setThemePreference, themePreference])

  return <SessionPreferencesContext.Provider value={value}>{children}</SessionPreferencesContext.Provider>
}

/** The session preferences when mounted, `null` otherwise (shell chrome, tests). */
export function useOptionalSessionPreferences() {
  return useContext(SessionPreferencesContext)
}

export function useSessionPreferences() {
  const value = useContext(SessionPreferencesContext)
  if (!value) throw new Error('useSessionPreferences must be used within SessionPreferencesProvider')
  return value
}
