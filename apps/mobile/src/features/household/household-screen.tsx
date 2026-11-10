import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, StyleSheet, View } from 'react-native'

import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { FormGroup, FormTextRow } from '@/components/ui/form-row'
import {
  SettingsLoading,
  SettingsNotice,
  SettingsPage,
  SettingsSection,
  SettingsSubheading,
} from '@/features/more/settings-ui'
import { themeTokens, type Palette } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { inviteEmailSchema } from './household-contract'
import { classifyHouseholdWriteFailure, type HouseholdWriteFailure } from './household-write-failures'
import { householdMemberLabel, type HouseholdViewModel } from './household-view-models'

export type HouseholdViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'invalid-response' }
  | { status: 'access-transition' }
  | { status: 'loaded'; data: HouseholdViewModel; refreshing?: boolean }
  | { status: 'refresh-error'; data: HouseholdViewModel; refreshing?: boolean }

export type HouseholdScreenProps = Readonly<{
  state: HouseholdViewState
  onBack: () => void
  onRetry: () => void | Promise<void>
  /** Throws on failure — the screen classifies and displays the failure itself, mirroring
   * account-edit-screen's onSaveAccount/onDeleteAccount convention. */
  onInvite: (email: string) => Promise<void>
  invitePending: boolean
  onResendInvite: () => Promise<void>
  resendPending: boolean
  onRevokeInvite: () => Promise<void>
  revokePending: boolean
  onRemoveMember: () => Promise<void>
  removePending: boolean
}>


const confirmDestructive = (title: string, message: string, cancel: string, proceed: string) => new Promise<boolean>((resolve) => {
  Alert.alert(title, message, [
    { text: cancel, style: 'cancel', onPress: () => resolve(false) },
    { text: proceed, style: 'destructive', onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) })
})

export function HouseholdScreen(props: HouseholdScreenProps) {
  const { t } = useTranslation()
  const palette = usePalette()

  if (props.state.status === 'access-transition') return null
  if (props.state.status === 'loading') {
    return (
      <SettingsPage backLabel={t('household.back')} onBack={props.onBack} section="household">
        <SettingsLoading label={t('household.loading')} />
      </SettingsPage>
    )
  }
  if (props.state.status !== 'loaded' && props.state.status !== 'refresh-error') {
    return <HouseholdFailure status={props.state.status} onBack={props.onBack} onRetry={props.onRetry} palette={palette} />
  }

  return (
    <HouseholdLoaded
      {...props}
      data={props.state.data}
      stale={props.state.status === 'refresh-error'}
      palette={palette}
    />
  )
}

function HouseholdLoaded({
  data,
  stale,
  onBack,
  onInvite,
  invitePending,
  onResendInvite,
  resendPending,
  onRevokeInvite,
  revokePending,
  onRemoveMember,
  removePending,
  palette,
}: Omit<HouseholdScreenProps, 'state' | 'onRetry'> & { data: HouseholdViewModel; stale: boolean; palette: Palette }) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [inviteFailure, setInviteFailure] = useState<HouseholdWriteFailure | null>(null)
  const [removeFailure, setRemoveFailure] = useState<HouseholdWriteFailure | null>(null)
  const [pendingInviteFailure, setPendingInviteFailure] = useState<HouseholdWriteFailure | null>(null)

  const runPendingInviteAction = async (action: () => Promise<void>) => {
    setPendingInviteFailure(null)
    try {
      await action()
    } catch (error) {
      setPendingInviteFailure(classifyHouseholdWriteFailure(error))
    }
  }

  const submitInvite = async () => {
    if (invitePending) return
    const parsed = inviteEmailSchema.safeParse(email)
    if (!parsed.success) {
      setEmailError(t('household.invite.invalidEmail'))
      return
    }
    setEmailError(null)
    setInviteFailure(null)
    try {
      await onInvite(parsed.data)
      setEmail('')
    } catch (error) {
      setInviteFailure(classifyHouseholdWriteFailure(error))
    }
  }

  const removeTarget = data.isOwner ? data.partner : data.me
  const confirmRemove = async () => {
    if (removePending || !removeTarget) return
    const confirmed = data.isOwner
      ? await confirmDestructive(
        t('household.removeDialog.title', { name: householdMemberLabel(removeTarget) }),
        t('household.removeDialog.description'),
        t('common.cancel'),
        t('household.removeDialog.confirm'),
      )
      : await confirmDestructive(
        t('household.leaveDialog.title'),
        t('household.leaveDialog.description'),
        t('common.cancel'),
        t('household.leaveDialog.confirm'),
      )
    if (!confirmed) return
    setRemoveFailure(null)
    try {
      await onRemoveMember()
    } catch (error) {
      setRemoveFailure(classifyHouseholdWriteFailure(error))
    }
  }

  return (
    <SettingsPage backLabel={t('household.back')} onBack={onBack} section="household">
      <SettingsSection first title={t('household.title')} description={t('settings.household.description')}>
        {stale ? <SettingsNotice alert message={t('household.stale')} /> : null}

        <View style={styles.block}>
          <SettingsSubheading title={t('household.members.heading')} />
          <View style={[styles.list, { borderColor: palette.border }]}>
            {data.members.map((member, index) => (
              <View
                key={member.appuserKey}
                style={[styles.memberRow, index > 0 && { borderTopWidth: 1, borderTopColor: palette.border }]}
              >
                <Avatar palette={palette} size={36} source={householdMemberLabel(member)} tone="neutral" />
                <View style={styles.memberText}>
                  <Text numberOfLines={1} variant="bodyStrong">{householdMemberLabel(member)}</Text>
                  <Text ellipsizeMode="middle" numberOfLines={1} tone="muted" variant="meta">{member.emailAddress}</Text>
                  <View style={styles.memberMeta}>
                    {member.appuserKey === data.me?.appuserKey ? (
                      <LabelledBadge label={t('household.members.you')} tone="secondary" />
                    ) : null}
                    <LabelledBadge
                      label={member.role === 'owner' ? t('household.members.roleOwner') : t('household.members.roleMember')}
                      tone={member.role === 'owner' ? 'primary' : 'outline'}
                    />
                  </View>
                </View>
                {data.isOwner && member.role === 'member' ? (
                  <Button
                    accessibilityLabel={t('household.actions.remove')}
                    disabled={removePending}
                    label={t('household.actions.remove')}
                    loading={removePending}
                    onPress={() => void confirmRemove()}
                    size="sm"
                    variant="ghost"
                  />
                ) : null}
              </View>
            ))}
          </View>
          {removeFailure ? (
            <Text accessibilityRole="alert" tone="destructive" variant="meta">{t(`household.removeFailures.${removeFailure}`)}</Text>
          ) : null}
        </View>

        {data.pendingInvite && data.isOwner ? (
          <View style={styles.block}>
            <SettingsSubheading title={t('household.pending.heading')} />
            <View style={[styles.pending, { borderColor: palette.border }]}>
              <View style={styles.memberText}>
                <Text variant="bodyStrong">{t('household.pending.sentTo', { email: data.pendingInvite.email })}</Text>
                <Text tone="muted" variant="meta">
                  {t('household.pending.expires', { date: new Date(data.pendingInvite.expiresAt).toLocaleDateString() })}
                </Text>
              </View>
              <View style={styles.pendingActions}>
                <Button
                  accessibilityLabel={t('household.pending.resend')}
                  disabled={resendPending}
                  label={resendPending ? t('household.pending.resending') : t('household.pending.resend')}
                  loading={resendPending}
                  onPress={() => void runPendingInviteAction(onResendInvite)}
                  size="sm"
                  variant="outline"
                />
                <Button
                  accessibilityLabel={t('household.pending.revoke')}
                  disabled={revokePending}
                  label={revokePending ? t('household.pending.revoking') : t('household.pending.revoke')}
                  loading={revokePending}
                  onPress={() => void runPendingInviteAction(onRevokeInvite)}
                  size="sm"
                  variant="ghost"
                />
              </View>
              {pendingInviteFailure ? (
                <Text accessibilityRole="alert" tone="destructive" variant="meta">{t(`household.inviteFailures.${pendingInviteFailure}`)}</Text>
              ) : null}
            </View>
          </View>
        ) : null}

        {data.canInvite ? (
          <View style={styles.block}>
            <SettingsSubheading title={t('household.invite.heading')} description={t('household.invite.description')} />
            <FormGroup>
              <FormTextRow
                autoCapitalize="none"
                autoComplete="email"
                editable={!invitePending}
                error={emailError ?? (inviteFailure ? t(`household.inviteFailures.${inviteFailure}`) : null)}
                keyboardType="email-address"
                label={t('household.invite.emailLabel')}
                onChangeText={(value) => { setEmail(value); setEmailError(null) }}
                placeholder={t('household.invite.emailPlaceholder')}
                value={email}
              />
            </FormGroup>
            <Button
              accessibilityLabel={t('household.invite.submit')}
              block
              disabled={invitePending}
              label={invitePending ? t('household.invite.sending') : t('household.invite.submit')}
              loading={invitePending}
              onPress={() => void submitInvite()}
            />
          </View>
        ) : null}

        {!data.isOwner && data.me ? (
          <Button
            accessibilityLabel={t('household.actions.leave')}
            block
            disabled={removePending}
            label={removePending ? t('household.leaving') : t('household.actions.leave')}
            loading={removePending}
            onPress={() => void confirmRemove()}
            variant="destructive"
          />
        ) : null}
      </SettingsSection>
    </SettingsPage>
  )
}

/** Web `Badge`; the screen reader reads the chip as its label. */
function LabelledBadge({ label, tone }: { label: string; tone: 'secondary' | 'primary' | 'outline' }) {
  return (
    <View accessible accessibilityLabel={label}>
      <Badge label={label} tone={tone} />
    </View>
  )
}

function HouseholdFailure({ status, onBack, onRetry }: {
  status: Exclude<HouseholdViewState['status'], 'loaded' | 'refresh-error' | 'loading' | 'access-transition'>
  onBack: () => void
  onRetry: () => void | Promise<void>
  palette?: Palette
}) {
  const { t } = useTranslation()
  return (
    <SettingsPage backLabel={t('household.back')} onBack={onBack} section="household">
      <SettingsNotice
        action={<Button label={t('common.retry')} onPress={() => void onRetry()} size="sm" variant="outline" />}
        message={t(`household.states.${status}Message`)}
        title={t(`household.states.${status}Title`)}
      />
    </SettingsPage>
  )
}

const styles = StyleSheet.create({
  block: { gap: themeTokens.spacing[3] },
  // The members as one settings group: a subtle rounded box, hairlines between rows.
  list: { borderWidth: 1, borderRadius: themeTokens.radius.xl, overflow: 'hidden' },
  memberRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[3], paddingHorizontal: themeTokens.spacing[4], paddingVertical: themeTokens.spacing[3] },
  memberText: { flex: 1, minWidth: 0, gap: 2 },
  memberMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: themeTokens.spacing[2], paddingTop: themeTokens.spacing[1] },
  pending: { borderWidth: 1, borderRadius: themeTokens.radius.xl, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] },
  pendingActions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
})
