import { ReactNode, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Linking, Pressable, StyleSheet, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Text } from '@/components/ui/text'
import { externalDestinations } from '@/features/more/link-policy'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { AuthField, AuthFooter, AuthLayout, AuthLink, AuthTextInput, FieldError } from './auth-form-styles'

export type SignUpOutcomeView = 'accepted' | 'email-taken' | 'weak-password' | 'unavailable'

export type SignUpScreenProps = {
  onSubmit: (email: string, password: string) => Promise<SignUpOutcomeView>
  footer?: ReactNode
  /** Pre-fills the email field — used when a validated household invite names the invitee. */
  initialEmail?: string
  /** Locks the email field so an invited partner can't sign up under a different address. */
  emailLocked?: boolean
  /** Extra copy shown above the title, e.g. a household-invite greeting. */
  greeting?: string
  /** The muted line under the title ("Free and open source. Already a member? Login here"). */
  lead?: ReactNode
  /** False under `OIDC_ONLY`: no password sign-up; the footer's single sign-on button creates the account. */
  passwordSignIn?: boolean
}

export function SignUpScreen({ onSubmit, footer, initialEmail, emailLocked = false, greeting, lead, passwordSignIn = true }: SignUpScreenProps) {
  const { t } = useTranslation()
  const palette = usePalette()
  const [email, setEmail] = useState(initialEmail ?? '')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const emailRef = useRef(initialEmail ?? '')
  const passwordRef = useRef('')
  const confirmPasswordRef = useRef('')
  const termsAcceptedRef = useRef(false)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [errors, setErrors] = useState<{
    email?: string
    password?: string
    confirmPassword?: string
    terms?: string
    submit?: string
  }>({})
  const [submitting, setSubmitting] = useState(false)

  const submit = () => {
    if (submitting) return
    const nextErrors: typeof errors = {}
    const normalizedEmail = emailRef.current.trim()
    if (!normalizedEmail) nextErrors.email = t('auth.validation.emailRequired')
    else if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) nextErrors.email = t('auth.validation.emailInvalid')
    if (!passwordRef.current) nextErrors.password = t('auth.validation.passwordRequired')
    else if (passwordRef.current.length < 8) nextErrors.password = t('auth.errors.weakPassword')
    if (!confirmPasswordRef.current) nextErrors.confirmPassword = t('auth.validation.confirmRequired')
    else if (confirmPasswordRef.current !== passwordRef.current) {
      nextErrors.confirmPassword = t('auth.validation.confirmMismatch')
    }
    if (!termsAcceptedRef.current) nextErrors.terms = t('auth.validation.termsRequired')
    if (nextErrors.email || nextErrors.password || nextErrors.confirmPassword || nextErrors.terms) {
      setErrors(nextErrors)
      return
    }

    setSubmitting(true)
    setErrors({})
    void onSubmit(normalizedEmail, passwordRef.current)
      .then((outcome) => {
        if (outcome === 'email-taken') setErrors({ submit: t('auth.errors.emailTaken') })
        if (outcome === 'weak-password') setErrors({ submit: t('auth.errors.weakPassword') })
        if (outcome === 'unavailable') setErrors({ submit: t('auth.errors.signupUnavailable') })
      })
      .catch(() => setErrors({ submit: t('auth.errors.unavailable') }))
      .finally(() => setSubmitting(false))
  }

  return (
    <AuthLayout
      eyebrow={greeting}
      footer={footer ? <AuthFooter>{footer}</AuthFooter> : undefined}
      lead={lead ?? <Text tone="muted" variant="meta">{t('auth.signup.helper')}</Text>}
      title={t('auth.signup.title')}
    >
      {passwordSignIn ? (
        <>
          <AuthField error={errors.email} label={t('auth.email')} required>
            <AuthTextInput
              accessibilityHint={emailLocked ? t('auth.join.emailLockedHint', { email: initialEmail ?? '' }) : undefined}
              accessibilityLabel={t('auth.email')}
              accessibilityState={{ disabled: emailLocked }}
              autoCapitalize="none"
              autoComplete="email"
              editable={!emailLocked}
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

          <AuthField error={errors.password} label={t('auth.password')} required>
            <AuthTextInput
              accessibilityLabel={t('auth.password')}
              autoCapitalize="none"
              autoComplete="password-new"
              invalid={Boolean(errors.password)}
              onChangeText={(value) => {
                passwordRef.current = value
                setPassword(value)
              }}
              placeholder={t('auth.password')}
              returnKeyType="next"
              secureTextEntry
              value={password}
            />
          </AuthField>

          <AuthField error={errors.confirmPassword} label={t('auth.signup.confirmPassword')} required>
            <AuthTextInput
              accessibilityLabel={t('auth.signup.confirmPassword')}
              autoCapitalize="none"
              autoComplete="password-new"
              invalid={Boolean(errors.confirmPassword)}
              onChangeText={(value) => {
                confirmPasswordRef.current = value
                setConfirmPassword(value)
              }}
              onSubmitEditing={submit}
              placeholder={t('auth.signup.confirmPassword')}
              returnKeyType="done"
              secureTextEntry
              value={confirmPassword}
            />
          </AuthField>

          <View style={termsStyles.group}>
            <View style={termsStyles.row}>
              <Pressable
                accessibilityLabel={t('auth.signup.termsConsent')}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: termsAccepted }}
                hitSlop={12}
                onPress={() => {
                  const next = !termsAcceptedRef.current
                  termsAcceptedRef.current = next
                  setTermsAccepted(next)
                }}
                style={[
                  termsStyles.box,
                  { borderColor: errors.terms ? palette.destructiveText : palette.input, backgroundColor: palette.card },
                  termsAccepted && { backgroundColor: palette.primary, borderColor: palette.primary },
                ]}
              >
                {termsAccepted ? <Icon color={palette.primaryForeground} name="check" size={14} weight="bold" /> : null}
              </Pressable>
              <View accessible={false} style={termsStyles.copy}>
                <Text tone="muted" variant="meta">{t('auth.signup.consentPrefix')} </Text>
                <AuthLink label={t('auth.signup.termsLink')} onPress={() => void Linking.openURL(externalDestinations.terms)} />
                <Text tone="muted" variant="meta"> {t('auth.signup.consentAnd')} </Text>
                <AuthLink label={t('auth.signup.privacyLink')} onPress={() => void Linking.openURL(externalDestinations.privacy)} />
              </View>
            </View>
            {errors.terms ? <FieldError>{errors.terms}</FieldError> : null}
          </View>

          {errors.submit ? (
            <Text accessible accessibilityLabel={errors.submit} accessibilityRole="alert" tone="destructive" variant="meta">
              {errors.submit}
            </Text>
          ) : null}

          <Button
            block
            disabled={submitting}
            label={submitting ? t('auth.signup.submitting') : t('auth.signup.submit')}
            onPress={submit}
          />
        </>
      ) : null}
    </AuthLayout>
  )
}

const termsStyles = StyleSheet.create({
  group: { gap: themeTokens.spacing[2] },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: themeTokens.spacing[3] },
  // Web's `Checkbox`: 16pt drawn larger here for the finger, 4pt radius.
  box: { width: 20, height: 20, marginTop: 2, borderWidth: 1, borderRadius: themeTokens.radius.sm, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
})
