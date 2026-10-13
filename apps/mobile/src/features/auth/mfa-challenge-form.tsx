import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, Text, TextInput, View } from 'react-native'

import { SelfAction, type Palette } from '@/features/self/self-screen-parts'
import { isValidTotpCode, normalizeTotpCode } from '@/lib/auth/mfa-code'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

export type MfaChallengeFormProps = Readonly<{
  submitting: boolean
  failure: 'invalid-code' | 'unavailable' | null
  onSubmit: (code: string) => void | Promise<void>
  palette: Palette
}>

/** Inline TOTP step-up shown on the `mfa-required` access-blocked screen. */
export function MfaChallengeForm({ submitting, failure, onSubmit, palette }: MfaChallengeFormProps) {
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

  return (
    <View style={styles.form}>
      <Text allowFontScaling style={[styles.label, { color: palette.foreground }]}>
        {t('access.mfa.codeLabel')}
      </Text>
      <TextInput
        accessibilityLabel={t('access.mfa.codeLabel')}
        autoComplete="one-time-code"
        editable={!submitting}
        inputMode="numeric"
        keyboardType="number-pad"
        maxLength={6}
        onChangeText={(value) => { setCode(value); setValidationFailed(false) }}
        onSubmitEditing={submit}
        placeholder={t('access.mfa.codePlaceholder')}
        placeholderTextColor={palette.mutedForeground}
        returnKeyType="done"
        style={[styles.input, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.card }]}
        value={code}
      />

      {validationFailed ? (
        <Text accessibilityRole="alert" allowFontScaling style={[styles.error, { color: palette.destructive }]}>
          {t('access.mfa.errors.validation')}
        </Text>
      ) : null}
      {failure === 'invalid-code' ? (
        <Text accessibilityRole="alert" allowFontScaling style={[styles.error, { color: palette.destructive }]}>
          {t('access.mfa.errors.invalidCode')}
        </Text>
      ) : null}
      {failure === 'unavailable' ? (
        <Text accessibilityRole="alert" allowFontScaling style={[styles.error, { color: palette.destructive }]}>
          {t('access.mfa.errors.unavailable')}
        </Text>
      ) : null}

      <SelfAction
        label={submitting ? t('access.mfa.verifying') : t('access.mfa.verify')}
        onPress={submit}
        disabled={submitting}
        palette={palette}
        primary
      />
    </View>
  )
}

const styles = StyleSheet.create({
  form: { width: '100%', gap: themeTokens.spacing[3] },
  label: { ...textStyles.bodyStrong, fontWeight: '600' as const },
  input: { ...textStyles.body, width: '100%', minHeight: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3] },
  error: { ...textStyles.body },
})
