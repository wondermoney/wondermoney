import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import {
  type LanguagePreference,
  resolveLocale,
  type ThemePreference,
  useSessionPreferences,
} from '@/components/providers/session-preferences-provider'
import { FormGroup, FormSelectRow, FormSwitchRow } from '@/components/ui/form-row'
import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'
import { SettingsField, SettingsPage, SettingsSection } from '@/features/more/settings-ui'

import { useAccountLanguageSync } from './account-language'
import { AiHiddenSection } from './ai-hidden-section'
import { PreviewFeaturesSection } from './preview-features-section'

const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark']
const LANGUAGES: readonly LanguagePreference[] = ['device', 'en', 'pt-PT', 'es']

/**
 * Settings › Appearance (web `components/settings/Appearance.tsx`): the section head,
 * then Theme, Language and privacy mode (amounts masked on this device). Three themes fit a segmented control (one tap, all choices
 * visible); the language is a settings row that opens the list. Mobile keeps its "System" theme and
 * "Device language" options and the note on what the language changes.
 */
export function PreferencesScreen() {
  const { t } = useTranslation()
  const preferences = useSessionPreferences()
  const themeLabel = (value: ThemePreference) => t(`preferences.theme.${value}`)
  const languageLabel = (value: LanguagePreference) => t(`preferences.locale.${value}`)
  const syncAccountLanguage = useAccountLanguageSync()
  // The account language follows the pick ("Device language" counts as the language it resolves to), so emails switch with the app.
  const chooseLanguage = (value: LanguagePreference) => {
    preferences.setLanguagePreference(value)
    syncAccountLanguage(resolveLocale(value, preferences.deviceLocale))
  }

  return (
    <SettingsPage backLabel={t('preferences.back')} section="appearance">
      <SettingsSection first title={t('settings.appearance.heading')} description={t('settings.appearance.description')}>
        <SettingsField label={t('settings.appearance.theme')}>
          <ThemeChoice
            label={t('settings.appearance.theme')}
            labelFor={themeLabel}
            onChange={preferences.setThemePreference}
            value={preferences.themePreference}
          />
        </SettingsField>
        <View style={styles.language}>
          <FormGroup>
            <FormSelectRow
              label={t('settings.appearance.language')}
              onChange={chooseLanguage}
              options={LANGUAGES.map((value) => ({ value, label: languageLabel(value) }))}
              placeholder={languageLabel('device')}
              testID="preferences-language"
              value={preferences.languagePreference}
            />
          </FormGroup>
          <Text tone="muted" variant="meta">{t('preferences.languageScope')}</Text>
        </View>
        <FormGroup>
          <FormSwitchRow
            hint={t('privacy.settingHelp')}
            label={t('privacy.setting')}
            onValueChange={preferences.setPrivacyMode}
            testID="preferences-privacy-mode"
            value={preferences.privacyMode}
          />
        </FormGroup>
      </SettingsSection>

      <PreviewFeaturesSection />

      <AiHiddenSection />
    </SettingsPage>
  )
}

/**
 * The segmented-control look (muted track, the chosen segment on the canvas; a hairline
 * stands in for web's `shadow-xs`, which lint keeps to the shared control) with radio semantics, because a theme is one choice of three.
 */
function ThemeChoice({ label, value, labelFor, onChange }: {
  label: string
  value: ThemePreference
  labelFor: (value: ThemePreference) => string
  onChange: (value: ThemePreference) => void
}) {
  const palette = usePalette()
  const [focused, setFocused] = useState<ThemePreference | null>(null)
  const slop = (themeTokens.touchTarget.minimum - SEGMENT_HEIGHT) / 2
  return (
    <View accessibilityLabel={label} accessibilityRole="radiogroup" style={[styles.track, { backgroundColor: palette.muted }]}>
      {THEMES.map((option) => {
        const selected = option === value
        return (
          <Pressable
            key={option}
            accessibilityLabel={labelFor(option)}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            hitSlop={{ top: slop, bottom: slop }}
            onBlur={() => setFocused(null)}
            onFocus={() => setFocused(option)}
            onPress={() => onChange(option)}
            style={({ pressed }) => [
              styles.segment,
              selected ? { backgroundColor: palette.background, borderWidth: 1, borderColor: palette.border } : null,
              focused === option && { borderWidth: 2, borderColor: palette.ring },
              pressed && { opacity: 0.72 },
            ]}
          >
            <Text style={{ color: selected ? palette.foreground : palette.mutedForeground }} variant="metaStrong">
              {labelFor(option)}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const SEGMENT_HEIGHT = 32

const styles = StyleSheet.create({
  language: { gap: themeTokens.spacing[2] },
  track: {
    flexDirection: 'row',
    minHeight: themeTokens.size.control,
    padding: themeTokens.spacing[1],
    borderRadius: themeTokens.radius.md,
  },
  segment: {
    flex: 1,
    minHeight: SEGMENT_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: themeTokens.spacing[3],
    borderRadius: themeTokens.radius.sm,
  },
})
