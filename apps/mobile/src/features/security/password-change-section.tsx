import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet } from 'react-native'

import { Button } from '@/components/ui/button'
import { FormGroup, FormTextRow } from '@/components/ui/form-row'
import { Text } from '@/components/ui/text'
import { SettingsSection } from '@/features/more/settings-ui'
import type { Palette } from '@/features/self/self-screen-parts'

export type PasswordChangeFailure = 'invalid-current-password' | 'weak-password' | 'unavailable'

export type PasswordChangeSectionProps = Readonly<{
  pending: boolean
  succeeded: boolean
  failure: PasswordChangeFailure | null
  onSubmit: (currentPassword: string, newPassword: string) => void | Promise<void>
  palette: Palette
}>

const MIN_LENGTH = 8

export function PasswordChangeSection({ pending, succeeded, failure, onSubmit }: PasswordChangeSectionProps) {
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

  // Each error sits under the row it is about; a failure that is about no one
  // field (a weak password per the server, the service unavailable) stays a
  // line under the group.
  const currentError = failure === 'invalid-current-password' ? t('security.password.errors.invalid-current-password') : null
  const newError = validation === 'too-short' ? t('security.password.errors.too-short') : null
  const confirmError = validation === 'mismatch' ? t('security.password.errors.mismatch') : null
  const formFailure = failure && failure !== 'invalid-current-password' ? t(`security.password.errors.${failure}`) : null
  return (
    <SettingsSection first title={t('security.password.heading')} description={t('settings.security.passwordDescription')}>
      <FormGroup>
        <FormTextRow
          key="current"
          autoComplete="current-password"
          editable={!pending}
          error={currentError}
          label={t('security.password.currentLabel')}
          onChangeText={setCurrentPassword}
          secureTextEntry
          value={currentPassword}
        />
        <FormTextRow
          key="new"
          autoComplete="new-password"
          editable={!pending}
          error={newError}
          label={t('security.password.newLabel')}
          onChangeText={(value) => { setNewPassword(value); setValidation(null) }}
          secureTextEntry
          value={newPassword}
        />
        <FormTextRow
          key="confirm"
          autoComplete="new-password"
          editable={!pending}
          error={confirmError}
          label={t('security.password.confirmLabel')}
          onChangeText={(value) => { setConfirmPassword(value); setValidation(null) }}
          onSubmitEditing={submit}
          returnKeyType="done"
          secureTextEntry
          value={confirmPassword}
        />
      </FormGroup>

      {formFailure ? <Text accessibilityRole="alert" tone="destructive" variant="meta">{formFailure}</Text> : null}
      {succeeded ? <Text tone="success" variant="meta">{t('security.password.success')}</Text> : null}

      <Button
        disabled={pending}
        label={pending ? t('security.password.saving') : t('security.password.save')}
        onPress={submit}
        style={styles.submit}
      />
    </SettingsSection>
  )
}

const styles = StyleSheet.create({
  // A section on a settings page, not a flow: a normal-width primary button at the start.
  submit: { alignSelf: 'flex-start' },
})
