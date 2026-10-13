import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { BackControl } from '@/components/ui/back-control'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import { inviteEmailSchema } from './household-contract'
import { classifyHouseholdWriteFailure, type HouseholdWriteFailure } from './household-write-failures'
import { householdMemberInitials, householdMemberLabel, type HouseholdViewModel } from './household-view-models'

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
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']

  if (props.state.status === 'access-transition') return null
  if (props.state.status === 'loading') {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
        <View accessibilityRole="progressbar" accessibilityLabel={t('household.loading')} style={styles.center}>
          <Text style={{ color: palette.foreground }}>{t('household.loading')}</Text>
        </View>
      </SafeAreaView>
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
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboard}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <View style={styles.page}>
            <BackControl fallback="/more" onPress={onBack} color={palette.primary} />
            <PageHeader palette={palette}
            helpText={t('household.helper')} title={t('household.title')} />
            {stale ? (
              <Text accessibilityRole="alert" allowFontScaling style={[styles.notice, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.muted }]}>
                {t('household.stale')}
              </Text>
            ) : null}

            <View style={styles.section}>
              <Text accessibilityRole="header" allowFontScaling style={[styles.sectionTitle, { color: palette.foreground }]}>{t('household.members.heading')}</Text>
              <View style={[styles.list, { borderColor: palette.border }]}>
                {data.members.map((member, index) => (
                  <View
                    key={member.appuserKey}
                    style={[styles.memberRow, index > 0 && { borderTopWidth: 1, borderTopColor: palette.border }]}
                  >
                    <View accessible={false} style={[styles.avatar, { backgroundColor: palette.muted }]}>
                      <Text allowFontScaling style={[styles.avatarText, { color: palette.foreground }]}>{householdMemberInitials(member)}</Text>
                    </View>
                    <View style={styles.memberText}>
                      <Text allowFontScaling style={[styles.memberName, { color: palette.foreground }]}>{householdMemberLabel(member)}</Text>
                      <Text allowFontScaling style={[styles.memberEmail, { color: palette.mutedForeground }]}>{member.emailAddress}</Text>
                    </View>
                    {member.appuserKey === data.me?.appuserKey ? (
                      <Badge label={t('household.members.you')} palette={palette} tone="muted" />
                    ) : null}
                    <Badge
                      label={member.role === 'owner' ? t('household.members.roleOwner') : t('household.members.roleMember')}
                      palette={palette}
                      tone={member.role === 'owner' ? 'accent' : 'muted'}
                    />
                    {data.isOwner && member.role === 'member' ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('household.actions.remove')}
                        accessibilityState={{ disabled: removePending }}
                        disabled={removePending}
                        onPress={() => void confirmRemove()}
                        style={({ pressed }) => [styles.smallButton, { borderColor: palette.destructive }, pressed && styles.pressed]}
                      >
                        <Text allowFontScaling style={[styles.smallButtonText, { color: palette.destructive }]}>{t('household.actions.remove')}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ))}
              </View>
            </View>

            {removeFailure ? (
              <Text accessibilityRole="alert" allowFontScaling style={[styles.notice, { color: palette.foreground, borderColor: palette.destructive }]}>
                {t(`household.removeFailures.${removeFailure}`)}
              </Text>
            ) : null}

            {data.pendingInvite && data.isOwner ? (
              <View style={styles.section}>
                <Text accessibilityRole="header" allowFontScaling style={[styles.sectionTitle, { color: palette.foreground }]}>{t('household.pending.heading')}</Text>
                <View style={[styles.pendingCard, { borderColor: palette.border }]}>
                  <View style={styles.memberText}>
                    <Text allowFontScaling style={[styles.memberName, { color: palette.foreground }]}>
                      {t('household.pending.sentTo', { email: data.pendingInvite.email })}
                    </Text>
                    <Text allowFontScaling style={[styles.memberEmail, { color: palette.mutedForeground }]}>
                      {t('household.pending.expires', { date: new Date(data.pendingInvite.expiresAt).toLocaleDateString() })}
                    </Text>
                  </View>
                  <View style={styles.pendingActions}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('household.pending.resend')}
                      accessibilityState={{ disabled: resendPending, busy: resendPending }}
                      disabled={resendPending}
                      onPress={() => void runPendingInviteAction(onResendInvite)}
                      style={({ pressed }) => [styles.smallButton, { borderColor: palette.primary }, pressed && styles.pressed]}
                    >
                      <Text allowFontScaling style={[styles.smallButtonText, { color: palette.primary }]}>
                        {resendPending ? t('household.pending.resending') : t('household.pending.resend')}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('household.pending.revoke')}
                      accessibilityState={{ disabled: revokePending, busy: revokePending }}
                      disabled={revokePending}
                      onPress={() => void runPendingInviteAction(onRevokeInvite)}
                      style={({ pressed }) => [styles.smallButton, { borderColor: palette.destructive }, pressed && styles.pressed]}
                    >
                      <Text allowFontScaling style={[styles.smallButtonText, { color: palette.destructive }]}>
                        {revokePending ? t('household.pending.revoking') : t('household.pending.revoke')}
                      </Text>
                    </Pressable>
                  </View>
                  {pendingInviteFailure ? (
                    <Text accessibilityRole="alert" allowFontScaling style={[styles.error, { color: palette.destructive }]}>
                      {t(`household.inviteFailures.${pendingInviteFailure}`)}
                    </Text>
                  ) : null}
                </View>
              </View>
            ) : null}

            {data.canInvite ? (
              <View style={styles.section}>
                <Text accessibilityRole="header" allowFontScaling style={[styles.sectionTitle, { color: palette.foreground }]}>{t('household.invite.heading')}</Text>
                <Text allowFontScaling style={[styles.helper, { color: palette.mutedForeground }]}>{t('household.invite.description')}</Text>
                <TextInput
                  accessibilityLabel={t('household.invite.emailLabel')}
                  autoCapitalize="none"
                  autoComplete="email"
                  editable={!invitePending}
                  keyboardType="email-address"
                  onChangeText={(value) => { setEmail(value); setEmailError(null) }}
                  placeholder={t('household.invite.emailPlaceholder')}
                  placeholderTextColor={palette.mutedForeground}
                  style={[styles.input, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.background }]}
                  value={email}
                />
                {emailError ? <Text accessibilityRole="alert" allowFontScaling style={[styles.error, { color: palette.destructive }]}>{emailError}</Text> : null}
                {inviteFailure ? (
                  <Text accessibilityRole="alert" allowFontScaling style={[styles.error, { color: palette.destructive }]}>
                    {t(`household.inviteFailures.${inviteFailure}`)}
                  </Text>
                ) : null}
                <Button
                  label={invitePending ? t('household.invite.sending') : t('household.invite.submit')}
                  onPress={() => void submitInvite()}
                  palette={palette}
                  variant="primary"
                  disabled={invitePending}
                />
              </View>
            ) : null}

            {!data.isOwner && data.me ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('household.actions.leave')}
                accessibilityState={{ disabled: removePending, busy: removePending }}
                disabled={removePending}
                onPress={() => void confirmRemove()}
                style={({ pressed }) => [styles.dangerButton, { borderColor: palette.destructive }, (pressed || removePending) && styles.pressed]}
              >
                <Text allowFontScaling style={[styles.dangerButtonText, { color: palette.destructive }]}>
                  {removePending ? t('household.leaving') : t('household.actions.leave')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function Badge({ label, palette, tone }: { label: string; palette: Palette; tone: 'accent' | 'muted' }) {
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={[styles.badge, { backgroundColor: tone === 'accent' ? palette.primary : palette.muted }]}
    >
      <Text allowFontScaling style={[styles.badgeText, { color: tone === 'accent' ? palette.background : palette.mutedForeground }]}>{label}</Text>
    </View>
  )
}

function HouseholdFailure({ status, onBack, onRetry, palette }: {
  status: Exclude<HouseholdViewState['status'], 'loaded' | 'refresh-error' | 'loading' | 'access-transition'>
  onBack: () => void
  onRetry: () => void | Promise<void>
  palette: Palette
}) {
  const { t } = useTranslation()
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <View style={styles.center}>
        <Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>{t(`household.states.${status}Title`)}</Text>
        <Text style={[styles.helper, { color: palette.mutedForeground }]}>{t(`household.states.${status}Message`)}</Text>
        <Button label={t('common.retry')} onPress={() => void onRetry()} palette={palette} variant="primary" />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('household.back')}
          onPress={onBack}
          style={styles.back}
        >
          <Text style={[styles.backText, { color: palette.primary }]}>{t('household.back')}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  keyboard: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding },
  page: { width: '100%', maxWidth: 720, alignSelf: 'center', gap: themeTokens.layout.blockGap },
  center: { flex: 1, width: '100%', maxWidth: 520, alignSelf: 'center', justifyContent: 'center', padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[4] },
  back: { minHeight: themeTokens.touchTarget.minimum, justifyContent: 'center', alignSelf: 'flex-start' },
  backText: { ...textStyles.action },
  heading: { gap: themeTokens.spacing[2] },
  title: { ...textStyles.title, fontWeight: '700' as const },
  helper: { ...textStyles.body },
  section: { gap: themeTokens.spacing[3] },
  sectionTitle: { ...textStyles.section, fontWeight: '700' as const },
  list: { borderWidth: 1, borderRadius: themeTokens.radius.lg, overflow: 'hidden' },
  memberRow: { minHeight: themeTokens.touchTarget.minimum, flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[3], padding: themeTokens.spacing[4] },
  avatar: { width: 36, height: 36, borderRadius: themeTokens.radius.pill, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...textStyles.bodyStrong, fontWeight: '700' as const },
  memberText: { flex: 1, minWidth: 0, gap: themeTokens.spacing[1] },
  memberName: { ...textStyles.action },
  memberEmail: { ...textStyles.amountSmall },
  badge: { borderRadius: themeTokens.radius.pill, paddingHorizontal: themeTokens.spacing[2], paddingVertical: themeTokens.spacing[1] },
  badgeText: { ...textStyles.label, fontWeight: '600' as const },
  smallButton: { minHeight: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3], alignItems: 'center', justifyContent: 'center' },
  smallButtonText: { ...textStyles.meta, fontWeight: '600' as const },
  pendingCard: { borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] },
  pendingActions: { flexDirection: 'row', gap: themeTokens.spacing[3] },
  input: { ...textStyles.body, minHeight: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3] },
  error: { ...textStyles.meta },
  button: { minHeight: themeTokens.touchTarget.minimum, borderRadius: themeTokens.radius.md, alignItems: 'center', justifyContent: 'center' },
  buttonText: { ...textStyles.action, fontWeight: '700' as const },
  dangerButton: { minHeight: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.md, alignItems: 'center', justifyContent: 'center' },
  dangerButtonText: { ...textStyles.action, fontWeight: '700' as const },
  notice: { ...textStyles.body, borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4] },
  pressed: { opacity: 0.72 },
})
