import { ReactNode, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'

import { AuthField, AuthLayout, AuthTextInput } from './auth-form-styles'

export type ConfirmResetOutcomeView = 'accepted' | 'weak-password' | 'link-expired' | 'unavailable'

export type ResetPasswordScreenProps = {
  onSubmit: (newPassword: string) => Promise<ConfirmResetOutcomeView>
  footer?: ReactNode
}

export function ResetPasswordScreen({ onSubmit, footer }: ResetPasswordScreenProps) {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const passwordRef = useRef('')
  const confirmPasswordRef = useRef('')
  const [errors, setErrors] = useState<{ password?: string; confirmPassword?: string; submit?: string }>({})
  const [submitting, setSubmitting] = useState(false)

  const submit = () => {
    if (submitting) return
    const nextErrors: typeof errors = {}
    if (!passwordRef.current) nextErrors.password = t('auth.validation.passwordRequired')
    else if (passwordRef.current.length < 8) nextErrors.password = t('auth.errors.weakPassword')
    if (!confirmPasswordRef.current) nextErrors.confirmPassword = t('auth.validation.confirmRequired')
    else if (confirmPasswordRef.current !== passwordRef.current) {
      nextErrors.confirmPassword = t('auth.validation.confirmMismatch')
    }
    if (nextErrors.password || nextErrors.confirmPassword) {
      setErrors(nextErrors)
      return
    }

    setSubmitting(true)
    setErrors({})
    void onSubmit(passwordRef.current)
      .then((outcome) => {
        if (outcome === 'weak-password') setErrors({ submit: t('auth.errors.weakPassword') })
        if (outcome === 'link-expired') setErrors({ submit: t('auth.errors.linkExpired') })
        if (outcome === 'unavailable') setErrors({ submit: t('auth.errors.unavailable') })
      })
      .catch(() => setErrors({ submit: t('auth.errors.unavailable') }))
      .finally(() => setSubmitting(false))
  }

  return (
    <AuthLayout
      footer={footer}
      lead={<Text tone="muted" variant="meta">{t('auth.resetPassword.helper')}</Text>}
      title={t('auth.resetPassword.title')}
    >
      <AuthField error={errors.password} label={t('auth.resetPassword.newPassword')} required>
        <AuthTextInput
          accessibilityLabel={t('auth.resetPassword.newPassword')}
          autoCapitalize="none"
          autoComplete="password-new"
          invalid={Boolean(errors.password)}
          onChangeText={(value) => {
            passwordRef.current = value
            setPassword(value)
          }}
          placeholder={t('auth.resetPassword.newPassword')}
          returnKeyType="next"
          secureTextEntry
          value={password}
        />
      </AuthField>

      <AuthField error={errors.confirmPassword} label={t('auth.resetPassword.confirmPassword')} required>
        <AuthTextInput
          accessibilityLabel={t('auth.resetPassword.confirmPassword')}
          autoCapitalize="none"
          autoComplete="password-new"
          invalid={Boolean(errors.confirmPassword)}
          onChangeText={(value) => {
            confirmPasswordRef.current = value
            setConfirmPassword(value)
          }}
          onSubmitEditing={submit}
          placeholder={t('auth.resetPassword.confirmPassword')}
          returnKeyType="done"
          secureTextEntry
          value={confirmPassword}
        />
      </AuthField>

      {errors.submit ? (
        <Text accessible accessibilityLabel={errors.submit} accessibilityRole="alert" tone="destructive" variant="meta">
          {errors.submit}
        </Text>
      ) : null}

      <Button
        block
        disabled={submitting}
        label={submitting ? t('auth.resetPassword.submitting') : t('auth.resetPassword.submit')}
        onPress={submit}
      />
    </AuthLayout>
  )
}
