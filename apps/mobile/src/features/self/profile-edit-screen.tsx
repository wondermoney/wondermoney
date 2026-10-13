import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollView, StyleSheet, Text, TextInput, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import { SelfAction, selfStyles } from './self-screen-parts'
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
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const [firstName, setFirstName] = useState(initialFirstName)
  const [lastName, setLastName] = useState(initialLastName)
  const [validation, setValidation] = useState(false)

  const submit = () => {
    if (pending) return
    const trimmedFirst = firstName.trim()
    const trimmedLast = lastName.trim()
    if (!trimmedFirst && !trimmedLast) {
      setValidation(true)
      return
    }
    setValidation(false)
    const payload: ProfileNamePayload = {
      ...(trimmedFirst ? { firstName: trimmedFirst } : {}),
      ...(trimmedLast ? { lastName: trimmedLast } : {}),
    }
    void onSubmit(payload)
  }

  return (
    <SafeAreaView style={[selfStyles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={selfStyles.content}>
        <View style={selfStyles.page}>
          <SelfAction label={t('profileEdit.cancel')} onPress={onCancel} palette={palette} disabled={pending} />

          <PageHeader palette={palette}
            instruction={t('profileEdit.helper')} title={t('profileEdit.title')} />

          <View style={styles.field}>
            <Text allowFontScaling style={[styles.label, { color: palette.foreground }]}>{t('profileEdit.firstName')}</Text>
            <TextInput
              accessibilityLabel={t('profileEdit.firstName')}
              autoCapitalize="words"
              editable={!pending}
              maxLength={100}
              onChangeText={setFirstName}
              placeholder={t('profileEdit.firstNamePlaceholder')}
              placeholderTextColor={palette.mutedForeground}
              style={[styles.input, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.card }]}
              value={firstName}
            />
          </View>

          <View style={styles.field}>
            <Text allowFontScaling style={[styles.label, { color: palette.foreground }]}>{t('profileEdit.lastName')}</Text>
            <TextInput
              accessibilityLabel={t('profileEdit.lastName')}
              autoCapitalize="words"
              editable={!pending}
              maxLength={100}
              onChangeText={setLastName}
              placeholder={t('profileEdit.lastNamePlaceholder')}
              placeholderTextColor={palette.mutedForeground}
              style={[styles.input, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.card }]}
              value={lastName}
            />
          </View>

          {validation ? (
            <Text accessibilityRole="alert" allowFontScaling style={[styles.error, { color: palette.destructive }]}>{t('profileEdit.validation')}</Text>
          ) : null}
          {failure ? (
            <Text accessibilityRole="alert" allowFontScaling style={[styles.error, { color: palette.destructive }]}>{t(`profileEdit.errors.${failure}`)}</Text>
          ) : null}

          <Button label={pending ? t('profileEdit.saving') : t('profileEdit.save')} onPress={submit} palette={palette} variant="primary" disabled={pending} />
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  field: { gap: themeTokens.spacing[2] },
  label: { ...textStyles.bodyStrong, fontWeight: '600' as const },
  input: { ...textStyles.body, minHeight: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3] },
  error: { ...textStyles.body },
})
