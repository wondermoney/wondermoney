import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import {
  type LanguagePreference,
  type ThemePreference,
  useSessionPreferences,
} from '@/components/providers/session-preferences-provider'
import { PageHeader } from '@/components/ui/page-header'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

export function PreferencesScreen() {
  const router = useRouter()
  const { t } = useTranslation()
  const preferences = useSessionPreferences()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const themes: ThemePreference[] = ['system', 'light', 'dark']
  const languages: LanguagePreference[] = ['device', 'en', 'pt-PT', 'es']

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.page}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('preferences.back')} onPress={() => router.back()} style={styles.back}>
            <Text allowFontScaling style={[styles.action, { color: palette.primary }]}>{t('preferences.back')}</Text>
          </Pressable>
          <PageHeader palette={palette}
            helpText={t('preferences.helper')} title={t('preferences.title')} />
          <ChoiceGroup
            label={t('preferences.appearance')}
            values={themes}
            selected={preferences.themePreference}
            labelFor={(value) => t(`preferences.theme.${value}`)}
            onSelect={preferences.setThemePreference}
            palette={palette}
          />
          <ChoiceGroup
            label={t('preferences.language')}
            values={languages}
            selected={preferences.languagePreference}
            labelFor={(value) => t(`preferences.locale.${value}`)}
            onSelect={preferences.setLanguagePreference}
            palette={palette}
          />
          <View style={[styles.note, { borderColor: palette.border, backgroundColor: palette.muted }]}>
            <Text allowFontScaling style={[styles.noteText, { color: palette.foreground }]}>{t('preferences.sessionOnly')}</Text>
            <Text allowFontScaling style={[styles.noteText, { color: palette.mutedForeground }]}>{t('preferences.languageScope')}</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function ChoiceGroup<Value extends string>({ label, values, selected, labelFor, onSelect, palette }: {
  label: string
  values: readonly Value[]
  selected: Value
  labelFor: (value: Value) => string
  onSelect: (value: Value) => void
  palette: (typeof themeTokens.colors)[keyof typeof themeTokens.colors]
}) {
  return <View style={styles.group} accessibilityRole="radiogroup">
    <Text accessibilityRole="header" allowFontScaling style={[styles.groupTitle, { color: palette.foreground }]}>{label}</Text>
    <View style={[styles.list, { borderColor: palette.border }]}>
      {values.map((value, index) => <Pressable
        key={value}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected === value }}
        accessibilityLabel={labelFor(value)}
        onPress={() => onSelect(value)}
        style={({ pressed }) => [styles.row, index > 0 && { borderTopColor: palette.border, borderTopWidth: 1 }, pressed && styles.pressed]}
      >
        <Text allowFontScaling style={[styles.rowText, { color: palette.foreground }]}>{labelFor(value)}</Text>
        <Text accessible={false} style={[styles.check, { color: selected === value ? palette.primary : palette.mutedForeground }]}>{selected === value ? '●' : '○'}</Text>
      </Pressable>)}
    </View>
  </View>
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, content: { flexGrow: 1, padding: themeTokens.layout.screenPadding }, page: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: themeTokens.spacing[6] },
  back: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }, action: { ...textStyles.action },
  heading: { gap: themeTokens.spacing[2] }, title: { ...textStyles.title }, helper: { ...textStyles.body },
  group: { gap: themeTokens.spacing[3] }, groupTitle: { ...textStyles.section },
  list: { borderWidth: 1, borderRadius: 12, overflow: 'hidden' }, row: { minHeight: 48, paddingHorizontal: themeTokens.spacing[4], paddingVertical: themeTokens.spacing[3], flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[4] }, rowText: { ...textStyles.body, flex: 1 }, check: { ...textStyles.title, fontWeight: '400' as const },
  note: { borderWidth: 1, borderRadius: 12, padding: themeTokens.spacing[4], gap: themeTokens.spacing[2] }, noteText: { ...textStyles.body }, pressed: { opacity: 0.72 },
})
