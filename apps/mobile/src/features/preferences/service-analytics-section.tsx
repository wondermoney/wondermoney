import { useTranslation } from 'react-i18next'

import { FormGroup, FormSwitchRow } from '@/components/ui/form-row'
import { Text } from '@/components/ui/text'
import { SettingsNotice, SettingsSection } from '@/features/more/settings-ui'

import { useServiceAnalytics } from './use-service-analytics'

/**
 * Settings › Appearance › Service analytics: the person's objection to the pseudonymous events
 * the API records, the same choice as web's Settings › Privacy. Stored on the account, so it
 * covers every client; shown only on a server that records them.
 */
export function ServiceAnalyticsSection() {
  const { t } = useTranslation()
  const analytics = useServiceAnalytics()
  if (!analytics.available) return null

  return (
    <SettingsSection
      description={t('settings.serviceAnalytics.description')}
      title={t('settings.serviceAnalytics.heading')}
    >
      <FormGroup>
        <FormSwitchRow
          disabled={analytics.isSaving}
          hint={t('settings.serviceAnalytics.hint')}
          label={t('settings.serviceAnalytics.label')}
          onValueChange={analytics.setEnabled}
          testID="preferences-service-analytics"
          value={analytics.enabled}
        />
      </FormGroup>

      {analytics.isSaving ? <Text accessibilityRole="alert" tone="muted" variant="label">{t('settings.serviceAnalytics.saving')}</Text> : null}
      {analytics.saveError ? (
        <SettingsNotice alert message={t('settings.serviceAnalytics.saveError')} tone="destructive" />
      ) : null}
    </SettingsSection>
  )
}
