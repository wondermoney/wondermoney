import { useTranslation } from 'react-i18next'
import { ScrollView, StyleSheet, View } from 'react-native'

import { BackControl } from '@/components/ui/back-control'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import { PageHeader } from '@/components/ui/page-header'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Text } from '@/components/ui/text'
import { SettingsLoading } from '@/features/more/settings-ui'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import type { AcceptInviteFailure } from './household-write-failures'

export type HouseholdJoinInvite = Readonly<{
  email: string
  inviterName: string | null
  householdName: string | null
  role: 'admin' | 'member' | 'viewer' | 'unknown'
}>

export type HouseholdJoinViewState =
  | { status: 'validating' }
  /** The token was refused by validation, or the screen was opened without one. */
  | { status: 'invalid' }
  /** Validation couldn't be reached; retrying may work. */
  | { status: 'unavailable' }
  | { status: 'ready'; invite: HouseholdJoinInvite; failure: AcceptInviteFailure | null }

export type HouseholdJoinScreenProps = Readonly<{
  state: HouseholdJoinViewState
  joining: boolean
  onJoin: () => void
  onCancel: () => void
  onRetry: () => void
}>

const ROLE_LABEL_KEY = {
  admin: 'household.members.roleAdmin',
  member: 'household.members.roleMember',
  viewer: 'household.members.roleViewer',
  unknown: 'household.members.roleMember',
} as const

const ROLE_DESCRIPTION_KEY = {
  admin: 'household.roles.adminDescription',
  member: 'household.roles.memberDescription',
  viewer: 'household.roles.viewerDescription',
  unknown: 'household.roles.memberDescription',
} as const

/**
 * The confirmation a signed-in person sees after opening an invite link: whose household, the
 * role, and what happens to what they have now. Nothing joins until they tap Join.
 */
export function HouseholdJoinScreen({ state, joining, onJoin, onCancel, onRetry }: HouseholdJoinScreenProps) {
  const { t } = useTranslation()
  const palette = usePalette()

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <BackControl disabled={joining} fallback="/settings/household" label={t('household.back')} onPress={onCancel} />
        {state.status === 'validating' ? <SettingsLoading label={t('household.joinExisting.validating')} /> : null}
        {state.status === 'invalid' ? (
          <View style={styles.body}>
            <PageHeader title={t('household.joinExisting.invalidTitle')} />
            <Text tone="muted" variant="body">{t('household.joinExisting.invalidBody')}</Text>
            <Button block label={t('household.joinExisting.notNow')} onPress={onCancel} variant="outline" />
          </View>
        ) : null}
        {state.status === 'unavailable' ? (
          <View style={styles.body}>
            <PageHeader title={t('household.joinExisting.unavailableTitle')} />
            <Notice
              action={<Button label={t('common.retry')} onPress={onRetry} size="sm" variant="outline" />}
              message={t('household.joinExisting.unavailableBody')}
            />
          </View>
        ) : null}
        {state.status === 'ready' ? (
          <JoinConfirmation failure={state.failure} invite={state.invite} joining={joining} onCancel={onCancel} onJoin={onJoin} />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

function JoinConfirmation({ invite, failure, joining, onJoin, onCancel }: {
  invite: HouseholdJoinInvite
  failure: AcceptInviteFailure | null
  joining: boolean
  onJoin: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const householdName = invite.householdName?.trim()
  const inviterName = invite.inviterName?.trim()
  const title = householdName
    ? t('household.joinExisting.titleHousehold', { name: householdName })
    : inviterName
      ? t('household.joinExisting.titleInviter', { name: inviterName })
      : t('household.joinExisting.titleGeneric')
  const role = t(ROLE_LABEL_KEY[invite.role])

  return (
    <View style={styles.body}>
      <PageHeader title={title} />
      <View style={styles.lines}>
        <Text variant="body">{t('household.joinExisting.role', { role })}</Text>
        <Text tone="muted" variant="meta">{t(ROLE_DESCRIPTION_KEY[invite.role])}</Text>
        <Text ellipsizeMode="middle" numberOfLines={1} tone="muted" variant="meta">{t('household.joinExisting.invitedEmail', { email: invite.email })}</Text>
      </View>

      <View style={styles.lines}>
        <Text accessibilityRole="header" variant="bodyStrong">{t('household.joinExisting.consequencesHeading')}</Text>
        {(['emptyOnly', 'leftBehind', 'banksDisconnected', 'yoursStays'] as const).map((key) => (
          <View key={key} style={styles.bullet}>
            <Text accessible={false} tone="muted" variant="meta">•</Text>
            <Text style={styles.bulletText} variant="meta">{t(`household.joinExisting.consequences.${key}`)}</Text>
          </View>
        ))}
      </View>

      {failure ? (
        <Notice
          message={t(`household.joinExisting.failures.${failure}`)}
          testID="household-join-failure"
          title={t('household.joinExisting.failureTitle')}
          tone="destructive"
        />
      ) : null}

      <View style={styles.actions}>
        <Button
          block
          disabled={joining}
          label={joining ? t('household.joinExisting.joining') : t('household.joinExisting.join')}
          loading={joining}
          onPress={onJoin}
        />
        <Button block disabled={joining} label={t('household.joinExisting.notNow')} onPress={onCancel} variant="outline" />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[4] },
  body: { gap: themeTokens.spacing[6] },
  lines: { gap: themeTokens.spacing[2] },
  bullet: { flexDirection: 'row', gap: themeTokens.spacing[2] },
  bulletText: { flex: 1 },
  actions: { gap: themeTokens.spacing[2] },
})
