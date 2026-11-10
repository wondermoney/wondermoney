import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { SettingsGroup, SettingsPage, SettingsSection, SettingsValueRow } from '@/features/more/settings-ui'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import type { ProfileViewModel } from './self-view-models'
import { SelfFailure, SelfLoading, SelfStaleBanner } from './self-screen-parts'

export type ProfileViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'invalid-response' }
  | { status: 'not-found' }
  | { status: 'access-transition' }
  | { status: 'loaded'; data: ProfileViewModel; refreshing?: boolean }
  | { status: 'refresh-error'; data: ProfileViewModel; refreshing?: boolean }

/**
 * Settings › Profile (web `components/settings/Profile.tsx`): "Personal information"
 * as one group of read-only rows (email, first and last name, label left and value
 * right), with "Edit name" beneath; the MFA status lives in Security, as on web.
 */
export function ProfileScreen({ state, onBack, onRetry, onLogout, onEdit }: {
  state: ProfileViewState
  onBack: () => void
  onRetry: () => void | Promise<void>
  onLogout: () => void | Promise<void>
  onEdit: () => void
}) {
  const { t } = useTranslation()
  const palette = usePalette()
  if (state.status === 'access-transition') return null
  if (state.status === 'loading') {
    return <SelfLoading label={t('profile.loading')} backLabel={t('self.back')} onBack={onBack} palette={palette} section="profile" />
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
      section="profile"
    />
  }

  const missing = t('self.notProvided')
  return (
    <SettingsPage backLabel={t('self.back')} onBack={onBack} section="profile">
      {state.status === 'refresh-error' ? (
        <View style={styles.stale}>
          <SelfStaleBanner message={t('profile.stale')} retryLabel={t('common.retry')} refreshing={Boolean(state.refreshing)} onRetry={onRetry} />
        </View>
      ) : null}
      <SettingsSection first title={t('settings.profile.heading')}>
        <SettingsGroup>
          <SettingsValueRow label={t('settings.profile.email')} value={state.data.emailAddress} />
          <SettingsValueRow label={t('profile.firstName')} value={state.data.firstName} missing={missing} />
          <SettingsValueRow label={t('profile.lastName')} value={state.data.lastName} missing={missing} />
        </SettingsGroup>
        <View style={styles.edit}>
          <Button label={t('profile.edit')} onPress={onEdit} variant="outline" />
        </View>
      </SettingsSection>
    </SettingsPage>
  )
}

const styles = StyleSheet.create({
  stale: { marginBottom: themeTokens.spacing[6] },
  edit: { alignItems: 'flex-start' },
})
