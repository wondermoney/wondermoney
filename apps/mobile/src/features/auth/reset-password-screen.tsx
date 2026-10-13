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

export type ConfirmResetOutcomeView = 'accepted' | 'weak-password' | 'link-expired' | 'unavailable'

export type ResetPasswordScreenProps = {
  onSubmit: (newPassword: string) => Promise<ConfirmResetOutcomeView>
  footer?: ReactNode
}

export function ResetPasswordScreen({ onSubmit, footer }: ResetPasswordScreenProps) {
  const { t } = useTranslation()
  const colorScheme = useColorScheme()
  const palette = themeTokens.colors[colorScheme === 'dark' ? 'dark' : 'light']
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const passwordRef = useRef('')
  const confirmPasswordRef = useRef('')
  const [focused, setFocused] = useState<'password' | 'confirmPassword' | null>(null)
  const [errors, setErrors] = useState<{ password?: string; confirmPassword?: string; submit?: string }>({})
  const [submitting, setSubmitting] = useState(false)
  const [buttonFocused, setButtonFocused] = useState(false)

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
                {t('auth.resetPassword.title')}
              </Text>
              <Text allowFontScaling style={[styles.helper, { color: palette.mutedForeground }]}>
                {t('auth.resetPassword.helper')}
              </Text>
            </View>

            <View style={styles.form}>
              <FieldLabel color={palette.foreground}>{t('auth.resetPassword.newPassword')}</FieldLabel>
              <TextInput
                accessibilityLabel={t('auth.resetPassword.newPassword')}
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

              <FieldLabel color={palette.foreground}>{t('auth.resetPassword.confirmPassword')}</FieldLabel>
              <TextInput
                accessibilityLabel={t('auth.resetPassword.confirmPassword')}
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
                  {submitting ? t('auth.resetPassword.submitting') : t('auth.resetPassword.submit')}
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
