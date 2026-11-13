import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, StyleSheet, View } from 'react-native'

import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FormGroup, FormSelectRow, FormTextRow } from '@/components/ui/form-row'
import { IconButton } from '@/components/ui/icon-button'
import { OptionSheet, Sheet, type SheetOption } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import {
  SettingsLoading,
  SettingsNotice,
  SettingsPage,
  SettingsSection,
  SettingsSubheading,
} from '@/features/more/settings-ui'
import { themeTokens, type Palette } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { GRANTABLE_HOUSEHOLD_ROLES, type GrantableHouseholdRole, type HouseholdRoleValue, inviteEmailSchema } from './household-contract'
import { classifyHouseholdWriteFailure, type HouseholdWriteFailure } from './household-write-failures'
import { householdMemberLabel, type HouseholdInviteRow, type HouseholdMemberRow, type HouseholdViewModel } from './household-view-models'

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
  /** Each write throws on failure: the screen classifies and displays the failure itself,
   * mirroring account-edit-screen's onSaveAccount/onDeleteAccount convention. */
  onInvite: (email: string, role: GrantableHouseholdRole) => Promise<void>
  invitePending: boolean
  onResendInvite: (householdInviteKey: number) => Promise<void>
  resendPending: boolean
  onRevokeInvite: (householdInviteKey: number) => Promise<void>
  revokePending: boolean
  onChangeRole: (appuserKey: number, role: GrantableHouseholdRole) => Promise<void>
  changeRolePending: boolean
  onTransferOwnership: (appuserKey: number) => Promise<void>
  transferPending: boolean
  /** Removes another member (a manager's action). */
  onRemoveMember: (appuserKey: number) => Promise<void>
  removePending: boolean
  /** The viewer leaves the household. */
  onLeave: () => Promise<void>
  leavePending: boolean
}>

const DEFAULT_INVITE_ROLE: GrantableHouseholdRole = 'member'

const confirmDestructive = (title: string, message: string, cancel: string, proceed: string) => new Promise<boolean>((resolve) => {
  Alert.alert(title, message, [
    { text: cancel, style: 'cancel', onPress: () => resolve(false) },
    { text: proceed, style: 'destructive', onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) })
})

const ROLE_LABEL_KEY: Readonly<Record<HouseholdRoleValue, string>> = {
  owner: 'household.members.roleOwner',
  admin: 'household.members.roleAdmin',
  member: 'household.members.roleMember',
  viewer: 'household.members.roleViewer',
  // A role this build doesn't know is shown as the plainest one.
  unknown: 'household.members.roleMember',
}

const ROLE_BADGE_TONE: Readonly<Record<HouseholdRoleValue, 'primary' | 'outline' | 'muted'>> = {
  owner: 'primary',
  admin: 'outline',
  member: 'outline',
  viewer: 'muted',
  unknown: 'outline',
}

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
    return <HouseholdFailure status={props.state.status} onBack={props.onBack} onRetry={props.onRetry} />
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

type MemberDialog =
  | { kind: 'menu'; member: HouseholdMemberRow }
  | { kind: 'role'; member: HouseholdMemberRow }
  | { kind: 'transfer'; member: HouseholdMemberRow }

type MemberMenuAction = 'role' | 'transfer' | 'remove'

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
  onChangeRole,
  changeRolePending,
  onTransferOwnership,
  transferPending,
  onRemoveMember,
  removePending,
  onLeave,
  leavePending,
  palette,
}: Omit<HouseholdScreenProps, 'state' | 'onRetry'> & { data: HouseholdViewModel; stale: boolean; palette: Palette }) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<GrantableHouseholdRole>(DEFAULT_INVITE_ROLE)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [inviteFailure, setInviteFailure] = useState<HouseholdWriteFailure | null>(null)
  const [memberFailure, setMemberFailure] = useState<HouseholdWriteFailure | null>(null)
  const [leaveFailure, setLeaveFailure] = useState<HouseholdWriteFailure | null>(null)
  const [pendingInviteFailure, setPendingInviteFailure] = useState<HouseholdWriteFailure | null>(null)
  const [dialog, setDialog] = useState<MemberDialog | null>(null)

  const memberBusy = changeRolePending || transferPending || removePending
  const roleLabel = (role: HouseholdRoleValue) => t(ROLE_LABEL_KEY[role])
  // The picker offers what the viewer may grant; a role the server no longer allows them falls
  // back to the default.
  const selectedInviteRole = data.inviteRoles.includes(inviteRole) ? inviteRole : (data.inviteRoles.includes(DEFAULT_INVITE_ROLE) ? DEFAULT_INVITE_ROLE : data.inviteRoles[0] ?? DEFAULT_INVITE_ROLE)
  const roleOptions = (roles: readonly GrantableHouseholdRole[]): SheetOption<GrantableHouseholdRole>[] => roles.map((role) => ({
    value: role,
    label: roleLabel(role),
    meta: t(`household.roles.${role}Description`),
  }))

  const runMemberAction = async (action: () => Promise<void>) => {
    setMemberFailure(null)
    try {
      await action()
    } catch (error) {
      setMemberFailure(classifyHouseholdWriteFailure(error))
    }
  }

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
      await onInvite(parsed.data, selectedInviteRole)
      setEmail('')
      setInviteRole(DEFAULT_INVITE_ROLE)
    } catch (error) {
      setInviteFailure(classifyHouseholdWriteFailure(error))
    }
  }

  const confirmRemove = async (member: HouseholdMemberRow) => {
    if (removePending) return
    const confirmed = await confirmDestructive(
      t('household.removeDialog.title', { name: householdMemberLabel(member) }),
      t('household.removeDialog.description'),
      t('common.cancel'),
      t('household.removeDialog.confirm'),
    )
    if (!confirmed) return
    await runMemberAction(() => onRemoveMember(member.appuserKey))
  }

  const confirmLeave = async () => {
    if (leavePending) return
    const confirmed = await confirmDestructive(
      t('household.leaveDialog.title'),
      t('household.leaveDialog.description'),
      t('common.cancel'),
      t('household.leaveDialog.confirm'),
    )
    if (!confirmed) return
    setLeaveFailure(null)
    try {
      await onLeave()
    } catch (error) {
      setLeaveFailure(classifyHouseholdWriteFailure(error))
    }
  }

  const onMenuAction = (member: HouseholdMemberRow, action: MemberMenuAction) => {
    if (action === 'role') setDialog({ kind: 'role', member })
    else if (action === 'transfer') setDialog({ kind: 'transfer', member })
    else void confirmRemove(member)
  }

  const menuOptions = (member: HouseholdMemberRow): SheetOption<MemberMenuAction>[] => [
    ...(member.actions.changeRoleTo.length > 0 ? [{ value: 'role' as const, label: t('household.actions.changeRole') }] : []),
    ...(member.actions.transferOwnership ? [{ value: 'transfer' as const, label: t('household.actions.transferOwnership') }] : []),
    ...(member.actions.remove ? [{ value: 'remove' as const, label: t('household.actions.remove'), destructive: true }] : []),
  ]

  return (
    <SettingsPage backLabel={t('household.back')} onBack={onBack} section="household">
      <SettingsSection first title={t('household.title')} description={t('settings.household.description')}>
        {stale ? <SettingsNotice alert message={t('household.stale')} /> : null}

        <View style={styles.block}>
          <SettingsSubheading title={t('household.members.heading')} />
          <View style={[styles.list, { borderColor: palette.border }]}>
            {data.members.map((member, index) => {
              const label = householdMemberLabel(member)
              const hasActions = menuOptions(member).length > 0
              return (
                <View
                  key={member.appuserKey}
                  style={[styles.memberRow, index > 0 && { borderTopWidth: 1, borderTopColor: palette.border }]}
                  testID={`household-member-${member.appuserKey}`}
                >
                  <Avatar palette={palette} size={36} source={label} tone="neutral" />
                  <View style={styles.memberText}>
                    <Text numberOfLines={1} variant="bodyStrong">{label}</Text>
                    <Text ellipsizeMode="middle" numberOfLines={1} tone="muted" variant="meta">{member.emailAddress}</Text>
                    <View style={styles.memberMeta}>
                      {member.isMe ? <LabelledBadge label={t('household.members.you')} tone="secondary" /> : null}
                      <LabelledBadge label={roleLabel(member.role)} tone={ROLE_BADGE_TONE[member.role]} />
                    </View>
                  </View>
                  {hasActions ? (
                    <IconButton
                      accessibilityLabel={t('household.actions.menuFor', { name: label })}
                      disabled={memberBusy}
                      icon="more-vertical"
                      onPress={() => setDialog({ kind: 'menu', member })}
                    />
                  ) : null}
                </View>
              )
            })}
          </View>
          {memberFailure ? (
            <Text accessibilityRole="alert" tone="destructive" variant="meta">{t(`household.memberFailures.${memberFailure}`)}</Text>
          ) : null}
        </View>

        {data.pendingInvites.length > 0 ? (
          <View style={styles.block}>
            <SettingsSubheading title={t('household.pending.heading')} />
            <View style={[styles.list, { borderColor: palette.border }]}>
              {data.pendingInvites.map((invite, index) => (
                <PendingInviteRow
                  first={index === 0}
                  invite={invite}
                  key={invite.householdInviteKey}
                  onResend={() => void runPendingInviteAction(() => onResendInvite(invite.householdInviteKey))}
                  onRevoke={() => void runPendingInviteAction(() => onRevokeInvite(invite.householdInviteKey))}
                  palette={palette}
                  resendPending={resendPending}
                  revokePending={revokePending}
                  roleLabel={roleLabel(invite.role)}
                />
              ))}
            </View>
            {pendingInviteFailure ? (
              <Text accessibilityRole="alert" tone="destructive" variant="meta">{t(`household.inviteFailures.${pendingInviteFailure}`)}</Text>
            ) : null}
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
              <FormSelectRow
                disabled={invitePending}
                label={t('household.invite.roleLabel')}
                onChange={setInviteRole}
                options={roleOptions(data.inviteRoles)}
                placeholder={roleLabel(DEFAULT_INVITE_ROLE)}
                value={selectedInviteRole}
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
        ) : data.myRole === 'owner' || data.myRole === 'admin' ? (
          <Text tone="muted" variant="meta">{t('household.invite.full', { max: data.maxMembers })}</Text>
        ) : null}

        {data.canLeave ? (
          <View style={styles.block}>
            <Button
              accessibilityLabel={t('household.actions.leave')}
              block
              disabled={leavePending}
              label={leavePending ? t('household.leaving') : t('household.actions.leave')}
              loading={leavePending}
              onPress={() => void confirmLeave()}
              variant="destructive"
            />
            {leaveFailure ? (
              <Text accessibilityRole="alert" tone="destructive" variant="meta">{t(`household.memberFailures.${leaveFailure}`)}</Text>
            ) : null}
          </View>
        ) : null}
      </SettingsSection>

      {dialog?.kind === 'menu' ? (
        <OptionSheet
          mode="menu"
          onClose={() => setDialog((current) => (current?.kind === 'menu' ? null : current))}
          onSelect={(action) => onMenuAction(dialog.member, action)}
          options={menuOptions(dialog.member)}
          title={householdMemberLabel(dialog.member)}
          visible
        />
      ) : null}

      {dialog?.kind === 'role' ? (
        <OptionSheet
          onClose={() => setDialog((current) => (current?.kind === 'role' ? null : current))}
          onSelect={(role) => {
            const member = dialog.member
            if (role === member.role) return
            void runMemberAction(() => onChangeRole(member.appuserKey, role))
          }}
          options={roleOptions(GRANTABLE_HOUSEHOLD_ROLES.filter((role) => role === dialog.member.role || dialog.member.actions.changeRoleTo.includes(role)))}
          title={t('household.roleDialog.title', { name: householdMemberLabel(dialog.member) })}
          value={dialog.member.role === 'owner' || dialog.member.role === 'unknown' ? null : dialog.member.role}
          visible
        />
      ) : null}

      {dialog?.kind === 'transfer' ? (
        <Sheet
          closeLabel={t('common.cancel')}
          footer={(
            <>
              <Button
                block
                disabled={transferPending}
                label={transferPending ? t('household.transferDialog.transferring') : t('household.transferDialog.confirm')}
                loading={transferPending}
                onPress={() => {
                  const member = dialog.member
                  setDialog(null)
                  void runMemberAction(() => onTransferOwnership(member.appuserKey))
                }}
              />
              <Button block label={t('common.cancel')} onPress={() => setDialog(null)} variant="outline" />
            </>
          )}
          onClose={() => setDialog(null)}
          title={t('household.transferDialog.title', { name: householdMemberLabel(dialog.member) })}
          visible
        >
          <Text variant="body">{t('household.transferDialog.description', { name: householdMemberLabel(dialog.member) })}</Text>
        </Sheet>
      ) : null}
    </SettingsPage>
  )
}

function PendingInviteRow({ invite, first, roleLabel, onResend, onRevoke, resendPending, revokePending, palette }: {
  invite: HouseholdInviteRow
  first: boolean
  roleLabel: string
  onResend: () => void
  onRevoke: () => void
  resendPending: boolean
  revokePending: boolean
  palette: Palette
}) {
  const { t } = useTranslation()
  return (
    <View style={[styles.pending, !first && { borderTopWidth: 1, borderTopColor: palette.border }]} testID={`household-invite-${invite.householdInviteKey}`}>
      <View style={styles.memberText}>
        <Text ellipsizeMode="middle" numberOfLines={1} variant="bodyStrong">{t('household.pending.sentTo', { email: invite.email })}</Text>
        <Text tone="muted" variant="meta">
          {t('household.pending.expires', { date: new Date(invite.expiresAt).toLocaleDateString() })}
        </Text>
        <View style={styles.memberMeta}>
          <LabelledBadge label={roleLabel} tone={ROLE_BADGE_TONE[invite.role]} />
        </View>
      </View>
      {invite.canManage ? (
        <View style={styles.pendingActions}>
          <Button
            accessibilityLabel={t('household.pending.resendFor', { email: invite.email })}
            disabled={resendPending}
            label={resendPending ? t('household.pending.resending') : t('household.pending.resend')}
            loading={resendPending}
            onPress={onResend}
            size="sm"
            variant="outline"
          />
          <Button
            accessibilityLabel={t('household.pending.revokeFor', { email: invite.email })}
            disabled={revokePending}
            label={revokePending ? t('household.pending.revoking') : t('household.pending.revoke')}
            loading={revokePending}
            onPress={onRevoke}
            size="sm"
            variant="ghost"
          />
        </View>
      ) : null}
    </View>
  )
}

/** Web `Badge`; the screen reader reads the chip as its label. */
function LabelledBadge({ label, tone }: { label: string; tone: 'secondary' | 'primary' | 'outline' | 'muted' }) {
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
  pending: { paddingHorizontal: themeTokens.spacing[4], paddingVertical: themeTokens.spacing[3], gap: themeTokens.spacing[3] },
  pendingActions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
})
