import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'

import { Text } from '@/components/ui/text'
import { Icon, type IconName } from '@/components/ui/icon'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { AuthLayout } from './auth-form-styles'
import { MfaChallengeForm, type MfaChallengeFormProps } from './mfa-challenge-form'

export type AccessBlockedStatus = 'mfa-required' | 'sign-out-failed'
export type AccessBlockedScreenProps = {
  status: AccessBlockedStatus
  onLogout?: () => void | Promise<void>
  onRetrySignOut?: () => void | Promise<void>
  onOpenPrivacy?: () => void | Promise<void>
  onOpenTerms?: () => void | Promise<void>
  onOpenSupport?: () => void | Promise<void>
  /** Only rendered (and only meaningful) while `status === 'mfa-required'`. */
  mfaChallenge?: Omit<MfaChallengeFormProps, 'palette'>
}

type SafeAction = 'privacy' | 'terms' | 'support' | 'signOut' | 'retrySignOut'

function completeSafeAction(
  operation: () => void | Promise<void>,
  onFailure: () => void,
  onComplete: () => void,
): Promise<void> {
  return Promise.resolve()
    .then(operation)
    .catch(onFailure)
    .finally(onComplete)
}

export function AccessBlockedScreen({
  status,
  onLogout,
  onRetrySignOut,
  onOpenPrivacy,
  onOpenTerms,
  onOpenSupport,
  mfaChallenge,
}: AccessBlockedScreenProps) {
  const { t } = useTranslation()
  const palette = usePalette()
  const key = status === 'mfa-required' ? 'mfa' : 'signOutFailed'
  const [busyAction, setBusyAction] = useState<SafeAction | null>(null)
  const [failedAction, setFailedAction] = useState<SafeAction | null>(null)

  const run = (action: SafeAction, operation?: () => void | Promise<void>) => {
    if (!operation || busyAction) return
    setBusyAction(action)
    setFailedAction(null)
    void completeSafeAction(
      operation,
      () => setFailedAction(action),
      () => setBusyAction(null),
    )
  }

  // The sign-in page's layout (web `(no-layout)/auth/mfa`): wordmark, title, the reason,
  // the code form when there is one, then the safe ways out as a hairline-divided list.
  return (
    <AuthLayout
      lead={<Text tone="muted" variant="meta">{t(`access.${key}.message`)}</Text>}
      title={t(`access.${key}.title`)}
    >
      {status === 'mfa-required' && mfaChallenge ? (
        <MfaChallengeForm {...mfaChallenge} palette={palette} />
      ) : null}

      <View style={styles.options}>
        <View style={[styles.list, { borderColor: palette.border }]}>
          {status === 'sign-out-failed' ? (
            <Action icon="log-out" label={t('access.retrySignOut')} busy={busyAction === 'retrySignOut'} onPress={() => void run('retrySignOut', onRetrySignOut)} />
          ) : (
            <Action icon="log-out" label={t('access.signOut')} busy={busyAction === 'signOut'} onPress={() => void run('signOut', onLogout)} />
          )}
          <Action external icon="mail" label={t('more.support')} helper={t('more.opensMail')} busy={busyAction === 'support'} onPress={() => void run('support', onOpenSupport)} separated />
          <Action external icon="shield" label={t('more.privacy')} helper={t('more.opensOutside')} busy={busyAction === 'privacy'} onPress={() => void run('privacy', onOpenPrivacy)} separated />
          <Action external icon="file-text" label={t('more.terms')} helper={t('more.opensOutside')} busy={busyAction === 'terms'} onPress={() => void run('terms', onOpenTerms)} separated />
        </View>
        {failedAction ? (
          <Text accessibilityRole="alert" style={[styles.failure, { borderColor: palette.border }]} variant="meta">
            {t('access.actionFailed')}
          </Text>
        ) : null}
      </View>
    </AuthLayout>
  )
}

function Action({ label, helper, onPress, icon, busy = false, external = false, separated = false }: {
  label: string
  helper?: string
  onPress?: () => void | Promise<void>
  icon: IconName
  busy?: boolean
  external?: boolean
  separated?: boolean
}) {
  const palette = usePalette()
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      accessibilityLabel={helper ? `${label}, ${helper}` : label}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={() => void onPress?.()}
      style={({ pressed }) => [
        styles.action,
        separated && { borderTopWidth: 1, borderTopColor: palette.border },
        focused && { borderWidth: 2, borderColor: palette.ring },
        (pressed || busy) && styles.pressed,
      ]}
    >
      <Icon color={palette.foreground} name={icon} size={themeTokens.size.icon} />
      <Text style={styles.actionLabel} variant="meta">{label}</Text>
      {external ? <Icon color={palette.mutedForeground} name="external-link" /> : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  options: { gap: themeTokens.spacing[3] },
  list: { borderTopWidth: 1, borderBottomWidth: 1 },
  action: {
    minHeight: themeTokens.touchTarget.minimum,
    flexDirection: 'row',
    alignItems: 'center',
    gap: themeTokens.spacing[3],
    paddingVertical: themeTokens.spacing[3],
  },
  actionLabel: { flex: 1 },
  failure: { borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4] },
  pressed: { opacity: 0.72 },
})
