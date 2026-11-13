import { getLocales } from 'expo-localization'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, StyleSheet, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { displayCategoryName } from '@/features/categories/categories-view-model'
import { SettingsNotice } from '@/features/more/settings-ui'
import { ApiError } from '@/lib/api/errors'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { presetRuleLine } from './rule-presets-contract'
import { useInstallRulePreset, useRulePresetPreview, useRulePresets } from './use-rule-presets'

function deviceRegion(): string | null {
  try {
    return getLocales()[0]?.regionCode ?? null
  } catch {
    return null
  }
}

/**
 * Settings › Rules: offers the locale rule preset that matches the app's language and the
 * device's region (web `RulePresetOffer`), with a preview of every rule it adds. It never
 * installs on its own: only the sheet's confirm button adds rules. Hidden once any of the preset
 * is in the household's rules, and for the rest of the session after "Not now".
 */
export function RulePresetOffer({ disabled = false }: { disabled?: boolean }) {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const query = useRulePresets({ language, region: deviceRegion() })
  const [dismissed, setDismissed] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const suggested = query.data?.presets.find((preset) => preset.code === query.data?.suggested) ?? null

  if (!suggested || suggested.installedCount > 0 || (dismissed && !previewing) || disabled) return null
  const name = t(`rulePresets.names.${suggested.code}`, { defaultValue: suggested.code })

  return (
    <>
      <SettingsNotice
        action={(
          <View style={styles.actions}>
            <Button label={t('rulePresets.offer.dismiss')} onPress={() => setDismissed(true)} size="sm" variant="ghost" />
            <Button label={t('rulePresets.offer.preview')} onPress={() => setPreviewing(true)} size="sm" variant="secondary" />
          </View>
        )}
        message={t('rulePresets.offer.description', { count: suggested.ruleCount })}
        title={t('rulePresets.offer.title', { name })}
      />
      {previewing ? <RulePresetSheet code={suggested.code} name={name} onClose={() => setPreviewing(false)} /> : null}
    </>
  )
}

/** Every rule a preset would add, and the one button that adds them. */
export function RulePresetSheet({ code, name, onClose }: { code: string; name: string; onClose: () => void }) {
  const { t } = useTranslation()
  const palette = usePalette()
  const preview = useRulePresetPreview(code)
  const install = useInstallRulePreset()
  const lines = (preview.data?.rules ?? []).map(presetRuleLine)
  const toAdd = lines.filter((line) => line.status === 'new').length

  const confirm = () => {
    install.mutate(code, {
      onSuccess: ({ created }) => {
        onClose()
        Alert.alert(t('rulePresets.installed', { count: created.length }))
      },
      onError: (error) => {
        Alert.alert(error instanceof ApiError && error.code === 'demo-forbidden' ? t('rules.demoWriteBlocked') : error instanceof ApiError && error.code === 'household-read-only' ? t('common.householdReadOnly') : t('rulePresets.installError'))
      },
    })
  }

  return (
    <Sheet
      closeLabel={t('common.close')}
      footer={(
        <View style={styles.actions}>
          <Button label={t('common.cancel')} onPress={onClose} variant="secondary" />
          <Button
            disabled={!preview.data || toAdd === 0 || install.isPending}
            label={t('rulePresets.dialog.install', { count: toAdd })}
            loading={install.isPending}
            onPress={confirm}
          />
        </View>
      )}
      onClose={onClose}
      title={t('rulePresets.dialog.title', { name })}
      visible
    >
      <View style={styles.body}>
        <Text tone="muted" variant="meta">{t('rulePresets.dialog.description')}</Text>
        {preview.isPending ? <Text tone="muted" variant="meta">{t('rulePresets.dialog.loading')}</Text> : null}
        {preview.isError ? <Text accessibilityRole="alert" tone="destructive" variant="meta">{t('rulePresets.dialog.error')}</Text> : null}
        {lines.map((line) => {
          const sets = [
            line.category ? displayCategoryName({ name: line.category, isSystemCategory: true }, t) : null,
            line.merchant ? t('rulePresets.dialog.merchant', { name: line.merchant }) : null,
            line.status === 'new' ? null : t(`rulePresets.status.${line.status}`),
          ].filter(Boolean).join(' · ')
          const matches = [
            t('rulePresets.dialog.matches', { values: line.matches.join(', ') }),
            ...line.excludes.map((value) => t('rulePresets.dialog.excludes', { value })),
          ].join(' ')
          return (
            <View accessible key={line.name} style={[styles.row, { borderBottomColor: palette.border }]} testID={`rule-preset-${line.name}`}>
              <Text tone={line.status === 'new' ? 'default' : 'muted'} variant="metaStrong">{line.name}</Text>
              <Text tone="muted" variant="meta">{matches}</Text>
              <Text variant="meta">{sets}</Text>
            </View>
          )
        })}
        {preview.data && toAdd === 0 ? <Text tone="muted" variant="meta">{t('rulePresets.dialog.nothing')}</Text> : null}
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: themeTokens.spacing[2] },
  body: { gap: themeTokens.spacing[2], paddingBottom: themeTokens.spacing[2] },
  row: { gap: themeTokens.spacing[1], paddingVertical: themeTokens.spacing[2], borderBottomWidth: StyleSheet.hairlineWidth },
})
