import * as Clipboard from 'expo-clipboard'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { FormGroup, FormTextRow } from '@/components/ui/form-row'
import { Text } from '@/components/ui/text'
import { SettingsSection } from '@/features/more/settings-ui'

import { SelfAction, type Palette } from '@/features/self/self-screen-parts'
import { isValidTotpCode, normalizeTotpCode } from '@/lib/auth/mfa-code'
import { themeTokens } from '@/theme/tokens'

export type MfaSecuritySectionStatus = 'loading' | 'error' | 'off' | 'enrolling' | 'on'

export type MfaSecuritySectionProps = Readonly<{
  status: MfaSecuritySectionStatus
  /**
   * The unverified factor's setup secret and the one-time backup codes `twoFactor.enable`
   * returned; present only while `status === 'enrolling'`. Neither is stored or logged.
   */
  enrollment: { secret: string; uri: string; backupCodes: readonly string[] } | null
  enrollBusy: boolean
  enrollFailed: boolean
  confirmBusy: boolean
  confirmFailure: 'invalid-code' | 'unavailable' | null
  unenrollBusy: boolean
  unenrollFailed: boolean
  onRetryStatus: () => void
  onTurnOn: () => void | Promise<void>
  onConfirm: (code: string) => void | Promise<void>
  onCancelEnrollment: () => void
  onTurnOff: () => void | Promise<void>
  palette: Palette
}>

export function MfaSecuritySection({
  status,
  enrollment,
  enrollBusy,
  enrollFailed,
  confirmBusy,
  confirmFailure,
  unenrollBusy,
  unenrollFailed,
  onRetryStatus,
  onTurnOn,
  onConfirm,
  onCancelEnrollment,
  onTurnOff,
  palette,
}: MfaSecuritySectionProps) {
  const { t } = useTranslation()
  const [code, setCode] = useState('')
  const [validationFailed, setValidationFailed] = useState(false)
  const submitCode = () => {
    if (confirmBusy) return
    const normalized = normalizeTotpCode(code)
    if (!isValidTotpCode(normalized)) {
      setValidationFailed(true)
      return
    }
    setValidationFailed(false)
    void onConfirm(normalized)
  }

  return (
    <SettingsSection title={t('security.mfa.heading')} description={t('security.mfa.helper')}>

      {status === 'loading' ? (
        <Text accessibilityRole="progressbar" accessibilityLabel={t('security.mfa.loading')} variant="meta" tone="muted">
          {t('security.mfa.loading')}
        </Text>
      ) : null}

      {status === 'error' ? (
        <View style={styles.row}>
          <Text accessibilityRole="alert" variant="meta" tone="destructive">
            {t('security.mfa.statusUnavailable')}
          </Text>
          <SelfAction label={t('security.mfa.retry')} onPress={onRetryStatus} palette={palette} />
        </View>
      ) : null}

      {status === 'off' ? (
        <View style={styles.row}>
          <Text variant="metaStrong">
            {t('security.mfa.offLabel')}
          </Text>
          <SelfAction
            label={enrollBusy ? t('security.mfa.turningOn') : t('security.mfa.turnOn')}
            onPress={onTurnOn}
            disabled={enrollBusy}
            palette={palette}
          />
          {enrollFailed ? (
            <Text accessibilityRole="alert" variant="meta" tone="destructive">
              {t('security.mfa.errors.unavailable')}
            </Text>
          ) : null}
        </View>
      ) : null}

      {status === 'enrolling' && enrollment ? (
        <View style={styles.row}>
          <Text accessibilityRole="header" variant="metaStrong">
            {t('security.mfa.setupHeading')}
          </Text>
          <Text variant="meta" tone="muted">
            {t('security.mfa.setupHelper')}
          </Text>
          <View style={[styles.secretBox, { borderColor: palette.border, backgroundColor: palette.muted }]}>
            <Text variant="label" tone="muted">
              {t('security.mfa.secretLabel')}
            </Text>
            <Text selectable variant="amount">
              {enrollment.secret}
            </Text>
          </View>

          {/* Web's setup step: the backup codes under the key, before the code is confirmed. */}
          {enrollment.backupCodes.length > 0 ? (
            <BackupCodes codes={enrollment.backupCodes} palette={palette} />
          ) : null}

          <FormGroup>
            <FormTextRow
              key="code"
              autoComplete="one-time-code"
              editable={!confirmBusy}
              error={validationFailed ? t('security.mfa.errors.validation') : confirmFailure === 'invalid-code' ? t('security.mfa.errors.invalidCode') : null}
              inputMode="numeric"
              keyboardType="number-pad"
              label={t('security.mfa.codeLabel')}
              maxLength={6}
              onChangeText={(value) => { setCode(value); setValidationFailed(false) }}
              onSubmitEditing={submitCode}
              placeholder={t('security.mfa.codePlaceholder')}
              returnKeyType="done"
              value={code}
            />
          </FormGroup>

          {confirmFailure === 'unavailable' ? (
            <Text accessibilityRole="alert" variant="meta" tone="destructive">
              {t('security.mfa.errors.unavailable')}
            </Text>
          ) : null}

          <View style={styles.actions}>
            <SelfAction
              label={confirmBusy ? t('security.mfa.confirming') : t('security.mfa.confirm')}
              onPress={submitCode}
              disabled={confirmBusy}
              palette={palette}
              primary
            />
            <SelfAction label={t('security.mfa.cancel')} onPress={onCancelEnrollment} disabled={confirmBusy} palette={palette} />
          </View>
        </View>
      ) : null}

      {status === 'on' ? (
        <View style={styles.row}>
          <Text variant="metaStrong">
            {t('security.mfa.onLabel')}
          </Text>
          <SelfAction
            label={unenrollBusy ? t('security.mfa.turningOff') : t('security.mfa.turnOff')}
            onPress={onTurnOff}
            disabled={unenrollBusy}
            palette={palette}
          />
          {unenrollFailed ? (
            <Text accessibilityRole="alert" variant="meta" tone="destructive">
              {t('security.mfa.errors.unavailable')}
            </Text>
          ) : null}
        </View>
      ) : null}
    </SettingsSection>
  )
}

/**
 * The backup codes, shown once while setting up. Mounted only during enrolment, so the codes and
 * the copy notice go when setup ends or is cancelled.
 */
function BackupCodes({ codes, palette }: { codes: readonly string[]; palette: Palette }) {
  const { t } = useTranslation()
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')

  const copyCodes = async () => {
    try {
      await Clipboard.setStringAsync(codes.join('\n'))
      setCopy('copied')
    } catch {
      setCopy('failed')
    }
  }

  return (
    <View style={styles.backupCodes}>
      <Text variant="metaStrong">{t('security.mfa.backupCodesTitle')}</Text>
      <Text variant="meta" tone="muted">{t('security.mfa.backupCodesHelper')}</Text>
      <View
        accessibilityLabel={t('security.mfa.backupCodesTitle')}
        accessibilityRole="list"
        style={[styles.codeGrid, { borderColor: palette.border }]}
      >
        {codes.map((code) => (
          <Text key={code} selectable style={styles.codeCell} variant="amount">
            {code}
          </Text>
        ))}
      </View>
      <SelfAction label={t('security.mfa.copyBackupCodes')} onPress={copyCodes} palette={palette} />
      {copy === 'copied' ? (
        <Text accessibilityLiveRegion="polite" variant="meta" tone="muted">
          {t('security.mfa.backupCodesCopied')}
        </Text>
      ) : copy === 'failed' ? (
        <Text accessibilityRole="alert" variant="meta" tone="destructive">
          {t('security.mfa.errors.unavailable')}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { gap: themeTokens.spacing[3], alignItems: 'flex-start' },
  secretBox: {
    width: '100%',
    borderWidth: 1,
    borderRadius: themeTokens.radius.md,
    padding: themeTokens.spacing[3],
    gap: themeTokens.spacing[1],
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
  backupCodes: { width: '100%', gap: themeTokens.spacing[2], alignItems: 'flex-start' },
  // Web's `grid grid-cols-2 gap-1 rounded border p-3 font-mono text-sm`.
  codeGrid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: themeTokens.spacing[1],
    borderWidth: 1,
    borderRadius: themeTokens.radius.md,
    padding: themeTokens.spacing[3],
  },
  codeCell: { width: '50%' },
})
