import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollView, StyleSheet, View } from 'react-native'

import { FormBar } from '@/components/ui/form-bar'
import { FormGroup, FormTextRow } from '@/components/ui/form-row'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Text } from '@/components/ui/text'
import { FormNotice } from '@/features/transactions/form-field'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { selfStyles } from './self-screen-parts'
import type { ProfileNamePayload } from './profile-update-contract'
import type { ProfileUpdateFailure } from './use-update-profile'

export type ProfileEditScreenProps = {
  initialFirstName: string
  initialLastName: string
  pending: boolean
  failure: ProfileUpdateFailure | null
  onCancel: () => void
  onSubmit: (payload: ProfileNamePayload) => void | Promise<void>
}

export function ProfileEditScreen({
  initialFirstName,
  initialLastName,
  pending,
  failure,
  onCancel,
  onSubmit,
}: ProfileEditScreenProps) {
  const { t } = useTranslation()
  const palette = usePalette()
  const [firstName, setFirstName] = useState(initialFirstName)
  const [lastName, setLastName] = useState(initialLastName)

  const trimmedFirst = firstName.trim()
  const trimmedLast = lastName.trim()
  // At least one name: with both blank the ✓ stays disabled and says why
  // under the rows.
  const blank = !trimmedFirst && !trimmedLast

  const submit = () => {
    if (pending || blank) return
    const payload: ProfileNamePayload = {
      ...(trimmedFirst ? { firstName: trimmedFirst } : {}),
      ...(trimmedLast ? { lastName: trimmedLast } : {}),
    }
    void onSubmit(payload)
  }

  return (
    <SafeAreaView style={[selfStyles.safeArea, { backgroundColor: palette.background }]}>
      <FormBar
        closeDisabled={pending}
        closeLabel={t('common.close')}
        onClose={onCancel}
        onSave={submit}
        saveDisabled={blank || pending}
        saveLabel={pending ? t('profileEdit.saving') : t('profileEdit.save')}
        saving={pending}
        title={t('profileEdit.title')}
      />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.page}>
          <Text tone="muted" variant="meta">{t('profileEdit.helper')}</Text>
          <FormGroup>
            <FormTextRow
              key="first"
              accessibilityLabel={t('profileEdit.firstName')}
              autoCapitalize="words"
              editable={!pending}
              label={t('profileEdit.firstName')}
              maxLength={100}
              onChangeText={setFirstName}
              placeholder={t('profileEdit.firstNamePlaceholder')}
              value={firstName}
            />
            <FormTextRow
              key="last"
              accessibilityLabel={t('profileEdit.lastName')}
              autoCapitalize="words"
              editable={!pending}
              error={blank ? t('profileEdit.validation') : null}
              label={t('profileEdit.lastName')}
              maxLength={100}
              onChangeText={setLastName}
              placeholder={t('profileEdit.lastNamePlaceholder')}
              value={lastName}
            />
          </FormGroup>
          {failure ? <FormNotice tone="destructive">{t(`profileEdit.errors.${failure}`)}</FormNotice> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingHorizontal: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[10] },
  page: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: themeTokens.spacing[4] },
})
