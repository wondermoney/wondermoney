import { ReactNode, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'

import { AuthField, AuthLayout, AuthNotice, AuthTextInput } from './auth-form-styles'

export type RequestResetOutcomeView = 'sent' | 'rate-limited' | 'unavailable'

export type ForgotPasswordScreenProps = {
  onSubmit: (email: string) => Promise<RequestResetOutcomeView>
  notice?: string
  footer?: ReactNode
  /** The muted line under the title ("Not a member? Create an account"). */
  lead?: ReactNode
}

export function ForgotPasswordScreen({ onSubmit, notice, footer, lead }: ForgotPasswordScreenProps) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const emailRef = useRef('')
  const [errors, setErrors] = useState<{ email?: string; submit?: string }>({})
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const submit = () => {
    if (submitting) return
    const normalizedEmail = emailRef.current.trim()
    const nextErrors: typeof errors = {}
    if (!normalizedEmail) nextErrors.email = t('auth.validation.emailRequired')
    else if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) nextErrors.email = t('auth.validation.emailInvalid')
    if (nextErrors.email) {
      setErrors(nextErrors)
      return
    }

    setSubmitting(true)
    setErrors({})
    setSent(false)
    void onSubmit(normalizedEmail)
      .then((outcome) => {
        if (outcome === 'sent') { setSent(true); return }
        if (outcome === 'rate-limited') setErrors({ submit: t('auth.errors.rateLimited') })
        if (outcome === 'unavailable') setErrors({ submit: t('auth.errors.unavailable') })
      })
      .catch(() => setErrors({ submit: t('auth.errors.unavailable') }))
      .finally(() => setSubmitting(false))
  }

  return (
    <AuthLayout
      footer={footer}
      notice={notice ? <AuthNotice message={notice} tone="destructive" /> : undefined}
      lead={lead ?? <Text tone="muted" variant="meta">{t('auth.forgotPassword.helper')}</Text>}
      title={t('auth.forgotPassword.title')}
    >
      <AuthField error={errors.email} label={t('auth.email')}>
        <AuthTextInput
          accessibilityLabel={t('auth.email')}
          autoCapitalize="none"
          autoComplete="email"
          invalid={Boolean(errors.email)}
          keyboardType="email-address"
          onChangeText={(value) => {
            emailRef.current = value
            setEmail(value)
            setSent(false)
          }}
          onSubmitEditing={submit}
          placeholder={t('auth.email')}
          returnKeyType="done"
          value={email}
        />
      </AuthField>

      {sent ? <AuthNotice message={t('auth.forgotPassword.sent')} /> : null}

      {errors.submit ? (
        <Text accessible accessibilityLabel={errors.submit} accessibilityRole="alert" tone="destructive" variant="meta">
          {errors.submit}
        </Text>
      ) : null}

      <Button
        block
        disabled={submitting}
        label={submitting ? t('auth.forgotPassword.submitting') : t('auth.forgotPassword.submit')}
        onPress={submit}
      />
    </AuthLayout>
  )
}
