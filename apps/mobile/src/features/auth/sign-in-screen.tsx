import { ReactNode, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'

import { AuthField, AuthFooter, AuthLayout, AuthNotice, AuthTextInput } from './auth-form-styles'

export type SignInOutcome = 'accepted' | 'invalid-credentials' | 'unavailable' | 'mfa-pending'

export type SignInScreenProps = {
  onSubmit: (email: string, password: string) => Promise<SignInOutcome>
  notice?: string
  /** `default` for good news ("Password updated"); errors stay destructive. */
  noticeTone?: 'default' | 'destructive'
  /** The page title, "Welcome back". Defaults to "Sign in". */
  title?: string
  /** The muted line under the title ("Not a member? Create an account"). */
  lead?: ReactNode
  /** Sits right-aligned under the password, as web's "Forgot your password?". */
  forgotPasswordLink?: ReactNode
  /** Social sign-in, other links and the server switcher, under the submit button. */
  footer?: ReactNode
  /**
   * False when the server signs in through its identity provider only (`OIDC_ONLY`): the email
   * and password form is left out and the footer's single sign-on button is the way in.
   */
  passwordSignIn?: boolean
}

export function SignInScreen({ onSubmit, notice, noticeTone = 'destructive', title, lead, forgotPasswordLink, footer, passwordSignIn = true }: SignInScreenProps) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const emailRef = useRef('')
  const passwordRef = useRef('')
  const [errors, setErrors] = useState<{ email?: string; password?: string; submit?: string }>({})
  const [submitting, setSubmitting] = useState(false)

  const submit = () => {
    if (submitting) return
    const nextErrors: typeof errors = {}
    const normalizedEmail = emailRef.current.trim()
    if (!normalizedEmail) nextErrors.email = t('auth.validation.emailRequired')
    else if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) nextErrors.email = t('auth.validation.emailInvalid')
    if (!passwordRef.current) nextErrors.password = t('auth.validation.passwordRequired')
    if (nextErrors.email || nextErrors.password) {
      setErrors(nextErrors)
      return
    }

    setSubmitting(true)
    setErrors({})
    void onSubmit(normalizedEmail, passwordRef.current)
      .then((outcome) => {
        if (outcome === 'invalid-credentials') setErrors({ submit: t('auth.errors.invalidCredentials') })
        if (outcome === 'unavailable') setErrors({ submit: t('auth.errors.unavailable') })
      })
      .catch(() => setErrors({ submit: t('auth.errors.unavailable') }))
      .finally(() => setSubmitting(false))
  }

  return (
    <AuthLayout
      footer={footer ? <AuthFooter>{footer}</AuthFooter> : undefined}
      notice={notice ? <AuthNotice message={notice} tone={noticeTone} /> : undefined}
      lead={lead}
      title={title ?? t('auth.title')}
    >
      {passwordSignIn ? (
        <>
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
              }}
              placeholder={t('auth.email')}
              returnKeyType="next"
              value={email}
            />
          </AuthField>

          <AuthField error={errors.password} label={t('auth.password')}>
            <AuthTextInput
              accessibilityLabel={t('auth.password')}
              autoCapitalize="none"
              autoComplete="password"
              invalid={Boolean(errors.password)}
              onChangeText={(value) => {
                passwordRef.current = value
                setPassword(value)
              }}
              onSubmitEditing={submit}
              placeholder={t('auth.password')}
              returnKeyType="done"
              secureTextEntry
              value={password}
            />
          </AuthField>

          {forgotPasswordLink ? <View style={localStyles.forgot}>{forgotPasswordLink}</View> : null}

          {errors.submit ? (
            <Text accessible accessibilityLabel={errors.submit} accessibilityRole="alert" tone="destructive" variant="meta">
              {errors.submit}
            </Text>
          ) : null}

          <Button
            block
            disabled={submitting}
            label={submitting ? t('auth.submitting') : t('auth.submit')}
            onPress={submit}
          />
        </>
      ) : null}
    </AuthLayout>
  )
}

const localStyles = StyleSheet.create({
  // Web: `flex items-center justify-end`, the link on the right under the password.
  // A row, so AuthLink's alignSelf only sets its vertical position and the link sits right, as on web.
  forgot: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: -themeTokens.spacing[2] },
})
