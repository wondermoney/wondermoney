import { useTranslation } from 'react-i18next'

import { FormGroup, FormSwitchRow } from '@/components/ui/form-row'
import { Text } from '@/components/ui/text'
import { SettingsNotice, SettingsSection } from '@/features/more/settings-ui'

import { usePreviewFeatures } from './use-preview-features'

/**
 * Settings › Appearance › Preview features: the per-user switch that makes
 * preview features available across web and mobile. Stored on the account, so
 * the same choice follows the person to the other client.
 */
export function PreviewFeaturesSection() {
  const { t } = useTranslation()
  const preview = usePreviewFeatures()
  const disabled = preview.isLoading || preview.isSaving || preview.isLoadError

  return (
    <SettingsSection
      description={t('settings.appearance.previewFeatures.description')}
      title={t('settings.appearance.previewFeatures.heading')}
    >
      <FormGroup>
        <FormSwitchRow
          disabled={disabled}
          hint={t('settings.appearance.previewFeatures.hint')}
          label={t('settings.appearance.previewFeatures.label')}
          onValueChange={preview.setEnabled}
          testID="preferences-preview-features"
          value={preview.enabled}
        />
      </FormGroup>

      {preview.isLoadError ? (
        <SettingsNotice alert message={t('settings.appearance.previewFeatures.loadError')} tone="destructive" />
      ) : null}

      {preview.isSaving ? <Text accessibilityRole="alert" tone="muted" variant="label">{t('settings.appearance.previewFeatures.saving')}</Text> : null}
      {preview.saveError ? (
        <SettingsNotice alert message={t('settings.appearance.previewFeatures.saveError')} tone="destructive" />
      ) : null}
    </SettingsSection>
  )
}
