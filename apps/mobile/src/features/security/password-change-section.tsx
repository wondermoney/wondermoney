import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, Text, TextInput, View } from 'react-native'

import { SelfAction, type Palette } from '@/features/self/self-screen-parts'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

export type PasswordChangeFailure = 'invalid-current-password' | 'weak-password' | 'unavailable'

export type PasswordChangeSectionProps = Readonly<{
  pending: boolean
  succeeded: boolean
  failure: PasswordChangeFailure | null
  onSubmit: (currentPassword: string, newPassword: string) => void | Promise<void>
  palette: Palette
}>

const MIN_LENGTH = 8

export function PasswordChangeSection({ pending, succeeded, failure, onSubmit, palette }: PasswordChangeSectionProps) {
  const { t } = useTranslation()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [validation, setValidation] = useState<'too-short' | 'mismatch' | null>(null)

  const submit = () => {
    if (pending) return
    if (newPassword.length < MIN_LENGTH) {
      setValidation('too-short')
      return
    }
    if (newPassword !== confirmPassword) {
      setValidation('mismatch')
      return
    }
    setValidation(null)
    void onSubmit(currentPassword, newPassword)
  }

  return (
    <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.muted }]}>
      <Text accessibilityRole="header" allowFontScaling style={[styles.cardTitle, { color: palette.foreground }]}>
        {t('security.password.heading')}
      </Text>
      <Text allowFontScaling style={[styles.cardBody, { color: palette.mutedForeground }]}>
        {t('security.password.helper')}
      </Text>

      <View style={styles.field}>
        <Text allowFontScaling style={[styles.label, { color: palette.foreground }]}>{t('security.password.currentLabel')}</Text>
        <TextInput
          accessibilityLabel={t('security.password.currentLabel')}
          autoComplete="current-password"
          editable={!pending}
          onChangeText={setCurrentPassword}
          placeholder={t('security.password.currentLabel')}
          placeholderTextColor={palette.mutedForeground}
          secureTextEntry
          style={[styles.input, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.card }]}
          value={currentPassword}
        />
      </View>

      <View style={styles.field}>
        <Text allowFontScaling style={[styles.label, { color: palette.foreground }]}>{t('security.password.newLabel')}</Text>
        <TextInput
          accessibilityLabel={t('security.password.newLabel')}
          autoComplete="new-password"
          editable={!pending}
          onChangeText={(value) => { setNewPassword(value); setValidation(null) }}
          placeholder={t('security.password.newLabel')}
          placeholderTextColor={palette.mutedForeground}
          secureTextEntry
          style={[styles.input, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.card }]}
          value={newPassword}
        />
      </View>

      <View style={styles.field}>
        <Text allowFontScaling style={[styles.label, { color: palette.foreground }]}>{t('security.password.confirmLabel')}</Text>
        <TextInput
          accessibilityLabel={t('security.password.confirmLabel')}
          autoComplete="new-password"
          editable={!pending}
          onChangeText={(value) => { setConfirmPassword(value); setValidation(null) }}
          onSubmitEditing={submit}
          placeholder={t('security.password.confirmLabel')}
          placeholderTextColor={palette.mutedForeground}
          returnKeyType="done"
          secureTextEntry
          style={[styles.input, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.card }]}
          value={confirmPassword}
        />
      </View>

      {validation ? (
        <Text accessibilityRole="alert" allowFontScaling style={[styles.error, { color: palette.destructive }]}>
          {t(`security.password.errors.${validation}`)}
        </Text>
      ) : null}
      {failure ? (
        <Text accessibilityRole="alert" allowFontScaling style={[styles.error, { color: palette.destructive }]}>
          {t(`security.password.errors.${failure}`)}
        </Text>
      ) : null}
      {succeeded ? (
        <Text allowFontScaling style={[styles.success, { color: palette.foreground }]}>
          {t('security.password.success')}
        </Text>
      ) : null}

      <SelfAction
        label={pending ? t('security.password.saving') : t('security.password.save')}
        onPress={submit}
        disabled={pending}
        palette={palette}
        primary
      />
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: themeTokens.radius.lg,
    padding: themeTokens.spacing[4],
    gap: themeTokens.spacing[3],
  },
  cardTitle: { ...textStyles.section },
  cardBody: { ...textStyles.body },
  field: { gap: themeTokens.spacing[2] },
  label: { ...textStyles.bodyStrong, fontWeight: '600' as const },
  input: { ...textStyles.body, minHeight: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3] },
  error: { ...textStyles.body },
  success: { ...textStyles.body },
})
