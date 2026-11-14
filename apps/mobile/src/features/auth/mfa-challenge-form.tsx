import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import type { Palette } from '@/features/self/self-screen-parts'
import { isValidTotpCode, normalizeBackupCode, normalizeTotpCode } from '@/lib/auth/mfa-code'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import { AuthField, AuthTextInput, FieldError } from './auth-form-styles'
import type { MfaChallengeFailure } from './use-mfa-challenge'

export type MfaChallengeFormProps = Readonly<{
  submitting: boolean
  failure: MfaChallengeFailure | null
  onSubmit: (code: string) => void | Promise<void>
  onSubmitBackupCode: (code: string) => void | Promise<void>
  palette: Palette
}>

type Method = 'totp' | 'backup-code'

/**
 * Inline second-factor step shown on the `mfa-required` access-blocked screen, as web's
 * `MfaForm`: the authenticator code, or "Use a backup code" for one of the codes shown at
 * enrolment. Switching methods drops what was typed, and a refused code is cleared.
 */
export function MfaChallengeForm({ submitting, failure, onSubmit, onSubmitBackupCode }: MfaChallengeFormProps) {
  const { t } = useTranslation()
  const [method, setMethod] = useState<Method>('totp')
  const [code, setCode] = useState('')
  const [validationFailed, setValidationFailed] = useState(false)
  // A refused code is cleared as its failure arrives. Switching methods hides that failure: a
  // refused authenticator code says nothing about the backup-code field.
  const [seenFailure, setSeenFailure] = useState(failure)
  const [failureDismissed, setFailureDismissed] = useState(false)
  if (failure !== seenFailure) {
    setSeenFailure(failure)
    setFailureDismissed(false)
    if (failure) setCode('')
  }

  const backup = method === 'backup-code'

  const submit = () => {
    if (submitting) return
    if (backup) {
      const normalized = normalizeBackupCode(code)
      if (!normalized) {
        setValidationFailed(true)
        return
      }
      setValidationFailed(false)
      void onSubmitBackupCode(normalized)
      return
    }
    const normalized = normalizeTotpCode(code)
    if (!isValidTotpCode(normalized)) {
      setValidationFailed(true)
      return
    }
    setValidationFailed(false)
    void onSubmit(normalized)
  }

  const switchMethod = () => {
    setMethod(backup ? 'totp' : 'backup-code')
    setCode('')
    setValidationFailed(false)
    setFailureDismissed(true)
  }

  const shownFailure = failureDismissed ? null : failure
  const error = validationFailed
    ? t(backup ? 'access.mfa.errors.backupCodeValidation' : 'access.mfa.errors.validation')
    : shownFailure === 'invalid-code'
      ? t(backup ? 'access.mfa.errors.invalidBackupCode' : 'access.mfa.errors.invalidCode')
      : shownFailure === 'challenge-expired'
        ? t('access.mfa.errors.challengeExpired')
        : shownFailure === 'rate-limited'
          ? t('access.mfa.errors.rateLimited')
          : shownFailure === 'unavailable'
            ? t('access.mfa.errors.unavailable')
            : undefined

  return (
    <View style={styles.form}>
      {backup ? (
        // Web's order: label, input, description, then the error (AuthField would put the error
        // above the description).
        <View style={styles.field}>
          <AuthField label={t('access.mfa.backupCodeLabel')}>
            <AuthTextInput
              key="backup-code"
              accessibilityLabel={t('access.mfa.backupCodeLabel')}
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect={false}
              autoFocus
              editable={!submitting}
              invalid={Boolean(error)}
              onChangeText={(value) => { setCode(value); setValidationFailed(false) }}
              onSubmitEditing={submit}
              placeholder={t('access.mfa.backupCodePlaceholder')}
              returnKeyType="done"
              spellCheck={false}
              style={styles.code}
              value={code}
            />
          </AuthField>
          <Text tone="muted" variant="meta">{t('access.mfa.backupCodeHelper')}</Text>
          {error ? <FieldError>{error}</FieldError> : null}
        </View>
      ) : (
        <AuthField error={error} label={t('access.mfa.codeLabel')}>
          <AuthTextInput
            key="totp"
            accessibilityLabel={t('access.mfa.codeLabel')}
            autoComplete="one-time-code"
            editable={!submitting}
            inputMode="numeric"
            invalid={Boolean(error)}
            keyboardType="number-pad"
            maxLength={6}
            onChangeText={(value) => { setCode(value); setValidationFailed(false) }}
            onSubmitEditing={submit}
            placeholder={t('access.mfa.codePlaceholder')}
            returnKeyType="done"
            style={styles.code}
            value={code}
          />
        </AuthField>
      )}
      <View style={styles.actions}>
        <Button
          block
          disabled={submitting}
          label={submitting ? t('access.mfa.verifying') : t('access.mfa.verify')}
          onPress={submit}
        />
        <Button
          block
          disabled={submitting}
          label={backup ? t('access.mfa.useAuthenticator') : t('access.mfa.useBackupCode')}
          onPress={switchMethod}
          variant="link"
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  form: { width: '100%', gap: themeTokens.spacing[6] },
  field: { gap: themeTokens.spacing[2] },
  actions: { gap: themeTokens.spacing[2] },
  // The code reads as a figure: Geist Mono, spaced like web's OTP input.
  code: { ...textStyles.amount, letterSpacing: 4 },
})
