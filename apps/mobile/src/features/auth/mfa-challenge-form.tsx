import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { Button } from '@/components/ui/button'
import type { Palette } from '@/features/self/self-screen-parts'
import { isValidTotpCode, normalizeTotpCode } from '@/lib/auth/mfa-code'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import { AuthField, AuthTextInput } from './auth-form-styles'

export type MfaChallengeFormProps = Readonly<{
  submitting: boolean
  failure: 'invalid-code' | 'unavailable' | null
  onSubmit: (code: string) => void | Promise<void>
  palette: Palette
}>

/** Inline TOTP step-up shown on the `mfa-required` access-blocked screen. */
export function MfaChallengeForm({ submitting, failure, onSubmit }: MfaChallengeFormProps) {
  const { t } = useTranslation()
  const [code, setCode] = useState('')
  const [validationFailed, setValidationFailed] = useState(false)

  const submit = () => {
    if (submitting) return
    const normalized = normalizeTotpCode(code)
    if (!isValidTotpCode(normalized)) {
      setValidationFailed(true)
      return
    }
    setValidationFailed(false)
    void onSubmit(normalized)
  }

  const error = validationFailed
    ? t('access.mfa.errors.validation')
    : failure === 'invalid-code'
      ? t('access.mfa.errors.invalidCode')
      : failure === 'unavailable'
        ? t('access.mfa.errors.unavailable')
        : undefined

  return (
    <View style={styles.form}>
      <AuthField error={error} label={t('access.mfa.codeLabel')}>
        <AuthTextInput
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
      <Button
        block
        disabled={submitting}
        label={submitting ? t('access.mfa.verifying') : t('access.mfa.verify')}
        onPress={submit}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  form: { width: '100%', gap: themeTokens.spacing[6] },
  // The code reads as a figure: Geist Mono, spaced like web's OTP input.
  code: { ...textStyles.amount, letterSpacing: 4 },
})
