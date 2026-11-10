import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { FormGroup, FormSwitchRow, FormTextRow } from '@/components/ui/form-row'
import { Text } from '@/components/ui/text'
import { SettingsNotice, SettingsSection } from '@/features/more/settings-ui'
import { themeTokens } from '@/theme/tokens'

import {
  DATA_EXPORT_PASSWORD_MAX_LENGTH,
  DATA_EXPORT_PASSWORD_MIN_LENGTH,
  type DataExportPasswordProblem,
  dataExportPasswordProblem,
} from './data-export-contract'
import type { DataExportFailure } from './use-data-export'

export type { DataExportFailure } from './use-data-export'
export type DataExportSectionStatus = 'idle' | 'preparing' | 'ready' | 'failed'

export type DataExportSectionProps = {
  /** The server stores exports for download. Without file storage, exports are made on the web. */
  available: boolean
  status: DataExportSectionStatus
  /** Shown while a stored export is ready, as already-formatted text. */
  readyUntil: string | null
  /** The export being prepared or ready is password protected. */
  protectedExport?: boolean
  starting: boolean
  failure: DataExportFailure | null
  /**
   * Start an export, with `password` when the member chose to protect it. Resolves `true` once the
   * server accepted it, which clears the password from the form.
   */
  onStart: (password?: string) => boolean | Promise<boolean>
  onDownload: () => void
}

/**
 * Settings > Security: export everything the member can see as a zip of JSON and CSV files,
 * optionally protected with a password (a WinZip AES-256 zip that 7-Zip, Keka or WinRAR open), with
 * web's rules: at least 16 characters, typed twice. The password is sent once, in the request that
 * starts the export, and cleared from the form when the server accepts it.
 */
export function DataExportSection({ available, status, readyUntil, protectedExport = false, starting, failure, onStart, onDownload }: DataExportSectionProps) {
  const { t } = useTranslation()
  const [protect, setProtect] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [problem, setProblem] = useState<DataExportPasswordProblem | null>(null)

  const clearPassword = () => {
    setPassword('')
    setConfirmation('')
    setProblem(null)
  }

  const start = async () => {
    if (starting) return
    if (protect) {
      const found = dataExportPasswordProblem(password, confirmation)
      setProblem(found)
      if (found) return
    }
    if (await onStart(protect ? password : undefined)) {
      clearPassword()
      setProtect(false)
    }
  }

  const preparing = status === 'preparing'
  const busy = starting || preparing
  const limits = { min: DATA_EXPORT_PASSWORD_MIN_LENGTH, max: DATA_EXPORT_PASSWORD_MAX_LENGTH }
  // A password the server rejected is about the password field; any other failure is about the export.
  const passwordError = problem === 'too-short'
    ? t('security.dataExport.errors.too-short', limits)
    : failure === 'password' ? t('security.dataExport.errors.password', limits) : null
  const confirmError = problem === 'mismatch' ? t('security.dataExport.errors.mismatch') : null
  const exportFailure = failure && failure !== 'password' ? t(`security.dataExport.errors.${failure}`) : null

  return (
    <SettingsSection title={t('security.dataExport.heading')} description={t('security.dataExport.helper')}>
      {!available ? (
        <Text tone="muted" variant="meta">{t('security.dataExport.webOnly')}</Text>
      ) : (
        <View style={styles.body}>
          {preparing ? <Text tone="muted" variant="meta">{t('security.dataExport.preparing')}</Text> : null}
          {status === 'ready' && readyUntil ? <Text tone="muted" variant="meta">{t('security.dataExport.readyUntil', { date: readyUntil })}</Text> : null}
          {protectedExport && (preparing || status === 'ready') ? <Text tone="muted" variant="meta">{t('security.dataExport.protected')}</Text> : null}
          {status === 'failed' ? <SettingsNotice message={t('security.dataExport.failed')} tone="destructive" /> : null}
          {exportFailure ? <SettingsNotice alert message={exportFailure} tone="destructive" /> : null}
          {status === 'ready' ? (
            <Button block label={t('security.dataExport.download')} onPress={onDownload} />
          ) : (
            <>
              {preparing ? null : (
                <FormGroup>
                  <FormSwitchRow
                    disabled={starting}
                    label={t('security.dataExport.protect')}
                    onValueChange={(next) => { setProtect(next); clearPassword() }}
                    value={protect}
                  />
                  {protect ? (
                    <>
                      <FormTextRow
                        key="password"
                        autoCapitalize="none"
                        autoComplete="new-password"
                        autoCorrect={false}
                        editable={!starting}
                        error={passwordError}
                        hint={t('security.dataExport.passwordHint', limits)}
                        label={t('security.dataExport.password')}
                        onChangeText={(value) => { setPassword(value); setProblem(null) }}
                        secureTextEntry
                        textContentType="newPassword"
                        value={password}
                      />
                      <FormTextRow
                        key="confirm"
                        autoCapitalize="none"
                        autoComplete="new-password"
                        autoCorrect={false}
                        editable={!starting}
                        error={confirmError}
                        label={t('security.dataExport.passwordConfirm')}
                        onChangeText={(value) => { setConfirmation(value); setProblem(null) }}
                        onSubmitEditing={() => void start()}
                        returnKeyType="done"
                        secureTextEntry
                        textContentType="newPassword"
                        value={confirmation}
                      />
                    </>
                  ) : null}
                </FormGroup>
              )}
              <Button
                block
                disabled={busy}
                label={t('security.dataExport.start')}
                loading={busy}
                onPress={() => void start()}
                variant="outline"
              />
            </>
          )}
        </View>
      )}
    </SettingsSection>
  )
}

const styles = StyleSheet.create({
  body: { gap: themeTokens.spacing[3] },
})
