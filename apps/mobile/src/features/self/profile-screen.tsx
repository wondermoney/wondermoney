import { useTranslation } from 'react-i18next'
import { ScrollView, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BackControl } from '@/components/ui/back-control'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { themeTokens } from '@/theme/tokens'

import type { ProfileViewModel } from './self-view-models'
import {
  ReadOnlyRow,
  SelfFailure,
  SelfLoading,
  SelfStaleBanner,
  selfStyles,
} from './self-screen-parts'

export type ProfileViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'invalid-response' }
  | { status: 'not-found' }
  | { status: 'access-transition' }
  | { status: 'loaded'; data: ProfileViewModel; refreshing?: boolean }
  | { status: 'refresh-error'; data: ProfileViewModel; refreshing?: boolean }

export function ProfileScreen({ state, onBack, onRetry, onLogout, onEdit }: {
  state: ProfileViewState
  onBack: () => void
  onRetry: () => void | Promise<void>
  onLogout: () => void | Promise<void>
  onEdit: () => void
}) {
  const { t } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  if (state.status === 'access-transition') return null
  if (state.status === 'loading') {
    return <SelfLoading label={t('profile.loading')} backLabel={t('self.back')} onBack={onBack} palette={palette} />
  }
  if (state.status === 'error' || state.status === 'invalid-response' || state.status === 'not-found') {
    const invalid = state.status === 'invalid-response'
    const notFound = state.status === 'not-found'
    return <SelfFailure
      title={t(notFound ? 'profile.notFoundTitle' : invalid ? 'profile.invalidTitle' : 'profile.errorTitle')}
      message={t(notFound ? 'profile.notFoundMessage' : invalid ? 'profile.invalidMessage' : 'profile.errorMessage')}
      backLabel={t('self.back')}
      retryLabel={t('common.retry')}
      signOutLabel={t('common.signOut')}
      onBack={onBack}
      onRetry={onRetry}
      onLogout={onLogout}
      palette={palette}
      retryable={!notFound}
    />
  }

  const missing = t('self.notProvided')
  return (
    <SafeAreaView style={[selfStyles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={selfStyles.content}>
        <View style={selfStyles.page}>
          <BackControl fallback="/more" label={t('self.back')} onPress={onBack} />
          {state.status === 'refresh-error' ? (
            <SelfStaleBanner message={t('profile.stale')} retryLabel={t('common.retry')} refreshing={Boolean(state.refreshing)} onRetry={onRetry} palette={palette} />
          ) : null}
          <PageHeader palette={palette}
            provenance={t('profile.helper')} title={t('profile.title')} />
          <View style={[selfStyles.list, { borderColor: palette.border }]}>
            <ReadOnlyRow label={t('profile.email')} value={state.data.emailAddress} palette={palette} />
            <ReadOnlyRow label={t('profile.firstName')} value={state.data.firstName ?? missing} palette={palette} separated />
            <ReadOnlyRow label={t('profile.lastName')} value={state.data.lastName ?? missing} palette={palette} separated />
            <ReadOnlyRow label={t('profile.mfa')} value={t(state.data.mfaEnabled ? 'self.enabled' : 'self.notEnabled')} palette={palette} separated />
          </View>
          <Button label={t('profile.edit')} onPress={onEdit} palette={palette} variant="primary" />
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
