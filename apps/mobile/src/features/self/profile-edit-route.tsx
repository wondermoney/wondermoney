import { type Href, usePreventRemove, useRouter } from 'expo-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useColorScheme } from 'react-native'

import { themeTokens } from '@/theme/tokens'

import { ProfileEditScreen } from './profile-edit-screen'
import type { ProfileNamePayload } from './profile-update-contract'
import { SelfLoading } from './self-screen-parts'
import { classifyProfileUpdateFailure, useUpdateProfile, type ProfileUpdateFailure } from './use-update-profile'
import { useProfile } from './use-self-resource'

export function ProfileEditRoute() {
  const query = useProfile()
  const mutation = useUpdateProfile()
  const router = useRouter()
  const { t } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const [failure, setFailure] = useState<ProfileUpdateFailure | null>(null)

  usePreventRemove(mutation.isPending)

  const goToProfile = () => {
    if (router.canGoBack()) router.back()
    else router.replace('/settings/profile' as unknown as Href)
  }

  // The profile is normally already cached from the Profile screen; while it loads,
  // present the shared skeleton rather than an empty form.
  if (query.isLoading || !query.data) {
    return <SelfLoading label={t('profileEdit.loading')} backLabel={t('common.back')} onBack={goToProfile} palette={palette} />
  }

  return (
    <ProfileEditScreen
      initialFirstName={query.data.profile.firstName ?? ''}
      initialLastName={query.data.profile.lastName ?? ''}
      pending={mutation.isPending}
      failure={failure}
      onCancel={goToProfile}
      onSubmit={async (payload: ProfileNamePayload) => {
        setFailure(null)
        try {
          await mutation.mutateAsync(payload)
          goToProfile()
        } catch (error) {
          setFailure(classifyProfileUpdateFailure(error))
        }
      }}
    />
  )
}
