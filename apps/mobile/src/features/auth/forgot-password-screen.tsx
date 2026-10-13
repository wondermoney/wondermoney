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

import { authFormStyles as styles, AuthLogo, FieldError, FieldLabel } from './auth-form-styles'

export type RequestResetOutcomeView = 'sent' | 'rate-limited' | 'unavailable'

export type ForgotPasswordScreenProps = {
  onSubmit: (email: string) => Promise<RequestResetOutcomeView>
  notice?: string
  footer?: ReactNode
}

export function ForgotPasswordScreen({ onSubmit, notice, footer }: ForgotPasswordScreenProps) {
  const { t } = useTranslation()
  const colorScheme = useColorScheme()
  const palette = themeTokens.colors[colorScheme === 'dark' ? 'dark' : 'light']
  const [email, setEmail] = useState('')
  const emailRef = useRef('')
  const [focused, setFocused] = useState(false)
  const [errors, setErrors] = useState<{ email?: string; submit?: string }>({})
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [buttonFocused, setButtonFocused] = useState(false)

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
                {t('auth.forgotPassword.title')}
              </Text>
              <Text allowFontScaling style={[styles.helper, { color: palette.mutedForeground }]}>
                {t('auth.forgotPassword.helper')}
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
                onBlur={() => setFocused(false)}
                onChangeText={(value) => {
                  emailRef.current = value
                  setEmail(value)
                  setSent(false)
                }}
                onFocus={() => setFocused(true)}
                onSubmitEditing={submit}
                returnKeyType="done"
                style={[
                  styles.input,
                  { color: palette.foreground, borderColor: focused ? palette.primary : palette.border },
                ]}
                value={email}
              />
              {errors.email ? <FieldError color={palette.destructive}>{errors.email}</FieldError> : null}

              {sent ? (
                <Text accessible accessibilityLabel={t('auth.forgotPassword.sent')} accessibilityRole="alert" allowFontScaling style={[styles.error, { color: palette.foreground }]}>
                  {t('auth.forgotPassword.sent')}
                </Text>
              ) : null}

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
                  {submitting ? t('auth.forgotPassword.submitting') : t('auth.forgotPassword.submit')}
                </Text>
              </Pressable>

              {footer}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
