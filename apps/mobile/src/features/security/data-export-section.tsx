import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { SettingsNotice, SettingsSection } from '@/features/more/settings-ui'
import { themeTokens } from '@/theme/tokens'

export type DataExportSectionStatus = 'idle' | 'preparing' | 'ready' | 'failed'
export type DataExportFailure = 'limit' | 'unknown'

export type DataExportSectionProps = {
  /** The server stores exports for download. Without file storage, exports are made on the web. */
  available: boolean
  status: DataExportSectionStatus
  /** Shown while a stored export is ready, as already-formatted text. */
  readyUntil: string | null
  starting: boolean
  failure: DataExportFailure | null
  onStart: () => void
  onDownload: () => void
}

/** Settings > Security: export everything the member can see as a zip of JSON and CSV files. */
export function DataExportSection({ available, status, readyUntil, starting, failure, onStart, onDownload }: DataExportSectionProps) {
  const { t } = useTranslation()

  return (
    <SettingsSection title={t('security.dataExport.heading')} description={t('security.dataExport.helper')}>
      {!available ? (
        <Text tone="muted" variant="meta">{t('security.dataExport.webOnly')}</Text>
      ) : (
        <View style={styles.body}>
          {status === 'preparing' ? <Text tone="muted" variant="meta">{t('security.dataExport.preparing')}</Text> : null}
          {status === 'ready' && readyUntil ? <Text tone="muted" variant="meta">{t('security.dataExport.readyUntil', { date: readyUntil })}</Text> : null}
          {status === 'failed' ? <SettingsNotice message={t('security.dataExport.failed')} tone="destructive" /> : null}
          {failure ? <SettingsNotice alert message={t(`security.dataExport.errors.${failure}`)} tone="destructive" /> : null}
          {status === 'ready' ? (
            <Button block label={t('security.dataExport.download')} onPress={onDownload} />
          ) : (
            <Button
              block
              disabled={starting || status === 'preparing'}
              label={t('security.dataExport.start')}
              loading={starting || status === 'preparing'}
              onPress={onStart}
              variant="outline"
            />
          )}
        </View>
      )}
    </SettingsSection>
  )
}

const styles = StyleSheet.create({
  body: { gap: themeTokens.spacing[3] },
})
