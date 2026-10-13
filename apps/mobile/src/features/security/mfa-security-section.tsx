import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, Text, TextInput, View } from 'react-native'

import { SelfAction, type Palette } from '@/features/self/self-screen-parts'
import { isValidTotpCode, normalizeTotpCode } from '@/lib/auth/mfa-code'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

export type MfaSecuritySectionStatus = 'loading' | 'error' | 'off' | 'enrolling' | 'on'

export type MfaSecuritySectionProps = Readonly<{
  status: MfaSecuritySectionStatus
  /** The unverified factor's setup secret; present only while `status === 'enrolling'`. */
  enrollment: { secret: string; uri: string } | null
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
    <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.muted }]}>
      <Text accessibilityRole="header" allowFontScaling style={[styles.cardTitle, { color: palette.foreground }]}>
        {t('security.mfa.heading')}
      </Text>
      <Text allowFontScaling style={[styles.cardBody, { color: palette.mutedForeground }]}>
        {t('security.mfa.helper')}
      </Text>

      {status === 'loading' ? (
        <Text accessibilityRole="progressbar" accessibilityLabel={t('security.mfa.loading')} allowFontScaling style={[styles.cardBody, { color: palette.mutedForeground }]}>
          {t('security.mfa.loading')}
        </Text>
      ) : null}

      {status === 'error' ? (
        <View style={styles.row}>
          <Text accessibilityRole="alert" allowFontScaling style={[styles.error, { color: palette.destructive }]}>
            {t('security.mfa.statusUnavailable')}
          </Text>
          <SelfAction label={t('security.mfa.retry')} onPress={onRetryStatus} palette={palette} />
        </View>
      ) : null}

      {status === 'off' ? (
        <View style={styles.row}>
          <Text allowFontScaling style={[styles.statusLabel, { color: palette.foreground }]}>
            {t('security.mfa.offLabel')}
          </Text>
          <SelfAction
            label={enrollBusy ? t('security.mfa.turningOn') : t('security.mfa.turnOn')}
            onPress={onTurnOn}
            disabled={enrollBusy}
            palette={palette}
          />
          {enrollFailed ? (
            <Text accessibilityRole="alert" allowFontScaling style={[styles.error, { color: palette.destructive }]}>
              {t('security.mfa.errors.unavailable')}
            </Text>
          ) : null}
        </View>
      ) : null}

      {status === 'enrolling' && enrollment ? (
        <View style={styles.row}>
          <Text accessibilityRole="header" allowFontScaling style={[styles.setupHeading, { color: palette.foreground }]}>
            {t('security.mfa.setupHeading')}
          </Text>
          <Text allowFontScaling style={[styles.cardBody, { color: palette.mutedForeground }]}>
            {t('security.mfa.setupHelper')}
          </Text>
          <View style={[styles.secretBox, { borderColor: palette.border }]}>
            <Text allowFontScaling style={[styles.secretLabel, { color: palette.mutedForeground }]}>
              {t('security.mfa.secretLabel')}
            </Text>
            <Text selectable allowFontScaling style={[styles.secretValue, { color: palette.foreground }]}>
              {enrollment.secret}
            </Text>
          </View>

          <Text allowFontScaling style={[styles.label, { color: palette.foreground }]}>
            {t('security.mfa.codeLabel')}
          </Text>
          <TextInput
            accessibilityLabel={t('security.mfa.codeLabel')}
            autoComplete="one-time-code"
            editable={!confirmBusy}
            inputMode="numeric"
            keyboardType="number-pad"
            maxLength={6}
            onChangeText={(value) => { setCode(value); setValidationFailed(false) }}
            onSubmitEditing={submitCode}
            placeholder={t('security.mfa.codePlaceholder')}
            placeholderTextColor={palette.mutedForeground}
            returnKeyType="done"
            style={[styles.input, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.card }]}
            value={code}
          />

          {validationFailed ? (
            <Text accessibilityRole="alert" allowFontScaling style={[styles.error, { color: palette.destructive }]}>
              {t('security.mfa.errors.validation')}
            </Text>
          ) : null}
          {confirmFailure === 'invalid-code' ? (
            <Text accessibilityRole="alert" allowFontScaling style={[styles.error, { color: palette.destructive }]}>
              {t('security.mfa.errors.invalidCode')}
            </Text>
          ) : null}
          {confirmFailure === 'unavailable' ? (
            <Text accessibilityRole="alert" allowFontScaling style={[styles.error, { color: palette.destructive }]}>
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
          <Text allowFontScaling style={[styles.statusLabel, { color: palette.foreground }]}>
            {t('security.mfa.onLabel')}
          </Text>
          <SelfAction
            label={unenrollBusy ? t('security.mfa.turningOff') : t('security.mfa.turnOff')}
            onPress={onTurnOff}
            disabled={unenrollBusy}
            palette={palette}
          />
          {unenrollFailed ? (
            <Text accessibilityRole="alert" allowFontScaling style={[styles.error, { color: palette.destructive }]}>
              {t('security.mfa.errors.unavailable')}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: themeTokens.radius.lg,
    padding: themeTokens.spacing[4],
    gap: themeTokens.spacing[3],
  },
  cardTitle: { ...textStyles.section },
  cardBody: { ...textStyles.body },
  row: { gap: themeTokens.spacing[3], alignItems: 'flex-start' },
  statusLabel: { ...textStyles.action },
  setupHeading: { ...textStyles.action },
  secretBox: {
    width: '100%',
    borderWidth: 1,
    borderRadius: themeTokens.radius.md,
    padding: themeTokens.spacing[3],
    gap: themeTokens.spacing[1],
  },
  secretLabel: { ...textStyles.meta },
  secretValue: { ...textStyles.body },
  label: { ...textStyles.bodyStrong, fontWeight: '600' as const },
  input: { ...textStyles.body, width: '100%', minHeight: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3] },
  error: { ...textStyles.body },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[3] },
})
