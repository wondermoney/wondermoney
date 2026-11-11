import { useTranslation } from 'react-i18next'

import { FormGroup, FormSwitchRow } from '@/components/ui/form-row'
import { Text } from '@/components/ui/text'
import { SettingsNotice, SettingsSection } from '@/features/more/settings-ui'

import { useAiHidden } from './use-ai-hidden'

/**
 * Settings › Appearance › AI features: the per-user switch that turns every AI
 * feature off, the same choice as web's Settings › Privacy. Stored on the
 * account, so it follows the person to the other client.
 */
export function AiHiddenSection() {
  const { t } = useTranslation()
  const ai = useAiHidden()
  const disabled = ai.isLoading || ai.isSaving || ai.isLoadError

  return (
    <SettingsSection
      description={t('settings.ai.description')}
      title={t('settings.ai.heading')}
    >
      <FormGroup>
        <FormSwitchRow
          disabled={disabled}
          hint={t('settings.ai.hint')}
          label={t('settings.ai.label')}
          onValueChange={ai.setHidden}
          testID="preferences-ai-hidden"
          value={ai.hidden}
        />
      </FormGroup>

      {ai.isLoadError ? (
        <SettingsNotice alert message={t('settings.ai.loadError')} tone="destructive" />
      ) : null}

      {ai.isSaving ? <Text accessibilityRole="alert" tone="muted" variant="label">{t('settings.ai.saving')}</Text> : null}
      {ai.saveError ? (
        <SettingsNotice alert message={t('settings.ai.saveError')} tone="destructive" />
      ) : null}
    </SettingsSection>
  )
}
