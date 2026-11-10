import * as SecureStore from 'expo-secure-store'

import type { LanguagePreference, ThemePreference } from '@/components/providers/session-preferences-provider'

/**
 * Device-local theme, language and privacy-mode choices. Plain, non-secret values kept in
 * SecureStore only because it is the one key-value store already wired into
 * this app (see `lib/security/app-lock-preference.ts`).
 */
const THEME_KEY = 'wondermoney.theme-preference'
const LANGUAGE_KEY = 'wondermoney.language-preference'
const PRIVACY_MODE_KEY = 'wondermoney.privacy-mode'

const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark']
const LANGUAGES: readonly LanguagePreference[] = ['device', 'en', 'pt-PT', 'es']

export type StoredPreferences = Readonly<{
  theme: ThemePreference | null
  language: LanguagePreference | null
  /** Whether amounts are masked. `null` when nothing was stored yet. */
  privacyMode: boolean | null
}>

export type PreferenceStorage = Readonly<{
  load: () => Promise<StoredPreferences>
  saveTheme: (value: ThemePreference) => Promise<void>
  saveLanguage: (value: LanguagePreference) => Promise<void>
  savePrivacyMode: (value: boolean) => Promise<void>
}>

const pick = <Value extends string>(allowed: readonly Value[], raw: string | null): Value | null =>
  raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as Value) : null

const pickBoolean = (raw: string | null): boolean | null => raw === 'on' ? true : raw === 'off' ? false : null

async function read(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key)
  } catch {
    return null
  }
}

async function write(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value)
  } catch {
    // A failed write keeps the choice for this session; nothing to surface.
  }
}

export const secureStorePreferenceStorage: PreferenceStorage = {
  load: async () => {
    const [theme, language, privacyMode] = await Promise.all([read(THEME_KEY), read(LANGUAGE_KEY), read(PRIVACY_MODE_KEY)])
    return { theme: pick(THEMES, theme), language: pick(LANGUAGES, language), privacyMode: pickBoolean(privacyMode) }
  },
  saveTheme: (value) => write(THEME_KEY, value),
  saveLanguage: (value) => write(LANGUAGE_KEY, value),
  savePrivacyMode: (value) => write(PRIVACY_MODE_KEY, value ? 'on' : 'off'),
}
