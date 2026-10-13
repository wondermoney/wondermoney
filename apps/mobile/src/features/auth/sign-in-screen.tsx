import { ReactNode, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  KeyboardAvoidingView,
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

import { authFormStyles as styles, AuthFooter, AuthLogo, FieldError, FieldLabel } from './auth-form-styles'

export type SignInOutcome = 'accepted' | 'invalid-credentials' | 'unavailable' | 'mfa-pending'

export type SignInScreenProps = {
  onSubmit: (email: string, password: string) => Promise<SignInOutcome>
  notice?: string
  footer?: ReactNode
}

export function SignInScreen({ onSubmit, notice, footer }: SignInScreenProps) {
  const { t } = useTranslation()
  const colorScheme = useColorScheme()
  const palette = themeTokens.colors[colorScheme === 'dark' ? 'dark' : 'light']
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const emailRef = useRef('')
  const passwordRef = useRef('')
  const [focused, setFocused] = useState<'email' | 'password' | null>(null)
  const [errors, setErrors] = useState<{ email?: string; password?: string; submit?: string }>({})
  const [submitting, setSubmitting] = useState(false)
  const [buttonFocused, setButtonFocused] = useState(false)

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
              <Text accessibilityRole="header" allowFontScaling style={[styles.title, { color: palette.foreground }]}>
                {t('auth.title')}
              </Text>
              <Text allowFontScaling style={[styles.helper, { color: palette.mutedForeground }]}>
                {t('auth.helper')}
              </Text>
            </View>

            {notice ? (
              <Text accessible accessibilityLabel={notice} accessibilityRole="alert" allowFontScaling style={[styles.error, { color: palette.destructive }]}>
                {notice}
              </Text>
            ) : null}

            <View style={styles.form}>
              <FieldLabel color={palette.foreground}>{t('auth.email')}</FieldLabel>
              <TextInput
                accessibilityLabel={t('auth.email')}
                autoCapitalize="none"
                autoComplete="email"
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
                ]}
                value={email}
              />
              {errors.email ? <FieldError color={palette.destructive}>{errors.email}</FieldError> : null}

              <FieldLabel color={palette.foreground}>{t('auth.password')}</FieldLabel>
              <TextInput
                accessibilityLabel={t('auth.password')}
                autoCapitalize="none"
                autoComplete="password"
                onBlur={() => setFocused(null)}
                onChangeText={(value) => {
                  passwordRef.current = value
                  setPassword(value)
                }}
                onFocus={() => setFocused('password')}
                onSubmitEditing={submit}
                returnKeyType="done"
                secureTextEntry
                style={[
                  styles.input,
                  { color: palette.foreground, borderColor: focused === 'password' ? palette.primary : palette.border },
                ]}
                value={password}
              />
              {errors.password ? <FieldError color={palette.destructive}>{errors.password}</FieldError> : null}

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
                  {submitting ? t('auth.submitting') : t('auth.submit')}
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
