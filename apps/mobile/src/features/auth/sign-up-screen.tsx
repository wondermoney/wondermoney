import { ReactNode, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'
import { externalDestinations } from '@/features/more/link-policy'

import { authFormStyles as styles, AuthFooter, AuthLogo, FieldError, FieldLabel } from './auth-form-styles'

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
}

export function SignUpScreen({ onSubmit, footer, initialEmail, emailLocked = false, greeting }: SignUpScreenProps) {
  const { t } = useTranslation()
  const colorScheme = useColorScheme()
  const palette = themeTokens.colors[colorScheme === 'dark' ? 'dark' : 'light']
  const [email, setEmail] = useState(initialEmail ?? '')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const emailRef = useRef(initialEmail ?? '')
  const passwordRef = useRef('')
  const confirmPasswordRef = useRef('')
  const termsAcceptedRef = useRef(false)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [focused, setFocused] = useState<'email' | 'password' | 'confirmPassword' | null>(null)
  const [errors, setErrors] = useState<{
    email?: string
    password?: string
    confirmPassword?: string
    terms?: string
    submit?: string
  }>({})
  const [submitting, setSubmitting] = useState(false)
  const [buttonFocused, setButtonFocused] = useState(false)

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
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboard}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.panel}>
            <AuthLogo />
            <View style={styles.headingGroup}>
              {greeting ? (
                <Text allowFontScaling style={[styles.helper, { color: palette.primary }]}>
                  {greeting}
                </Text>
              ) : null}
              <Text accessibilityRole="header" allowFontScaling style={[styles.title, { color: palette.foreground }]}>
                {t('auth.signup.title')}
              </Text>
              <Text allowFontScaling style={[styles.helper, { color: palette.mutedForeground }]}>
                {t('auth.signup.helper')}
              </Text>
            </View>

            <View style={styles.form}>
              <FieldLabel color={palette.foreground}>{t('auth.email')}</FieldLabel>
              <TextInput
                accessibilityLabel={t('auth.email')}
                accessibilityHint={emailLocked ? t('auth.join.emailLockedHint', { email: initialEmail ?? '' }) : undefined}
                accessibilityState={{ disabled: emailLocked }}
                autoCapitalize="none"
                autoComplete="email"
                editable={!emailLocked}
                keyboardType="email-address"
                onBlur={() => setFocused(null)}
                onChangeText={(value) => {
                  emailRef.current = value
                  setEmail(value)
                }}
                onFocus={() => setFocused('email')}
                returnKeyType="next"
                style={[
                  styles.input,
                  { color: palette.foreground, borderColor: focused === 'email' ? palette.primary : palette.border },
                  emailLocked && { backgroundColor: palette.muted },
                ]}
                value={email}
              />
              {errors.email ? <FieldError color={palette.destructive}>{errors.email}</FieldError> : null}

              <FieldLabel color={palette.foreground}>{t('auth.password')}</FieldLabel>
              <TextInput
                accessibilityLabel={t('auth.password')}
                autoCapitalize="none"
                autoComplete="password-new"
                onBlur={() => setFocused(null)}
                onChangeText={(value) => {
                  passwordRef.current = value
                  setPassword(value)
                }}
                onFocus={() => setFocused('password')}
                returnKeyType="next"
                secureTextEntry
                style={[
                  styles.input,
                  { color: palette.foreground, borderColor: focused === 'password' ? palette.primary : palette.border },
                ]}
                value={password}
              />
              {errors.password ? <FieldError color={palette.destructive}>{errors.password}</FieldError> : null}

              <FieldLabel color={palette.foreground}>{t('auth.signup.confirmPassword')}</FieldLabel>
              <TextInput
                accessibilityLabel={t('auth.signup.confirmPassword')}
                autoCapitalize="none"
                autoComplete="password-new"
                onBlur={() => setFocused(null)}
                onChangeText={(value) => {
                  confirmPasswordRef.current = value
                  setConfirmPassword(value)
                }}
                onFocus={() => setFocused('confirmPassword')}
                onSubmitEditing={submit}
                returnKeyType="done"
                secureTextEntry
                style={[
                  styles.input,
                  {
                    color: palette.foreground,
                    borderColor: focused === 'confirmPassword' ? palette.primary : palette.border,
                  },
                ]}
                value={confirmPassword}
              />
              {errors.confirmPassword ? (
                <FieldError color={palette.destructive}>{errors.confirmPassword}</FieldError>
              ) : null}

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
                    { borderColor: palette.border },
                    termsAccepted && { backgroundColor: palette.primary, borderColor: palette.primary },
                  ]}
                >
                  {termsAccepted ? <Text style={[termsStyles.check, { color: palette.background }]}>✓</Text> : null}
                </Pressable>
                <View
                  accessible={false}
                  style={termsStyles.copy}
                >
                  <Text allowFontScaling style={[termsStyles.label, { color: palette.foreground }]}>{t('auth.signup.consentPrefix')} </Text>
                  <Pressable hitSlop={12} accessibilityRole="link" accessibilityLabel={t('auth.signup.termsLink')} onPress={() => void Linking.openURL(externalDestinations.terms)}>
                    <Text allowFontScaling style={[termsStyles.link, { color: palette.primary }]}>{t('auth.signup.termsLink')}</Text>
                  </Pressable>
                  <Text allowFontScaling style={[termsStyles.label, { color: palette.foreground }]}> {t('auth.signup.consentAnd')} </Text>
                  <Pressable hitSlop={12} accessibilityRole="link" accessibilityLabel={t('auth.signup.privacyLink')} onPress={() => void Linking.openURL(externalDestinations.privacy)}>
                    <Text allowFontScaling style={[termsStyles.link, { color: palette.primary }]}>{t('auth.signup.privacyLink')}</Text>
                  </Pressable>
                </View>
              </View>
              {errors.terms ? <FieldError color={palette.destructive}>{errors.terms}</FieldError> : null}

              {errors.submit ? (
                <Text accessible accessibilityLabel={errors.submit} accessibilityRole="alert" allowFontScaling style={[styles.error, { color: palette.destructive }]}>
                  {errors.submit}
                </Text>
              ) : null}

              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: submitting, busy: submitting }}
                disabled={submitting}
                onBlur={() => setButtonFocused(false)}
                onFocus={() => setButtonFocused(true)}
                onPress={submit}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { backgroundColor: palette.primary },
                  buttonFocused && { borderColor: palette.foreground, borderWidth: 2 },
                  (pressed || submitting) && styles.buttonPressed,
                ]}
              >
                <Text allowFontScaling style={[styles.buttonLabel, { color: palette.background }]}>
                  {submitting ? t('auth.signup.submitting') : t('auth.signup.submit')}
                </Text>
              </Pressable>

               <AuthFooter>{footer}</AuthFooter>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const termsStyles = {
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: themeTokens.spacing[3], marginTop: themeTokens.spacing[1] },
  box: { width: 20, height: 20, borderWidth: 1, borderRadius: themeTokens.radius.sm },
  check: { ...textStyles.action, fontWeight: '700' as const, textAlign: 'center' as const },
  copy: { flex: 1, flexDirection: 'row' as const, flexWrap: 'wrap' as const, alignItems: 'center' as const },
  label: { ...textStyles.body },
  link: { ...textStyles.bodyStrong, fontWeight: '600' as const, textDecorationLine: 'underline' as const },
}
