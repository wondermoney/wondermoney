import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

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
  const colorScheme = useColorScheme()
  const palette = themeTokens.colors[colorScheme === 'dark' ? 'dark' : 'light']
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

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.panel}>
          <View style={[styles.marker, { backgroundColor: status === 'sign-out-failed' ? palette.destructive : palette.primary }]} />
          <View>
            <Text accessibilityRole="header" allowFontScaling style={[styles.title, { color: palette.foreground }]}>
              {t(`access.${key}.title`)}
            </Text>
            <Text allowFontScaling style={[styles.message, { color: palette.mutedForeground }]}>
              {t(`access.${key}.message`)}
            </Text>
          </View>

          {status === 'mfa-required' && mfaChallenge ? (
            <MfaChallengeForm {...mfaChallenge} palette={palette} />
          ) : null}

          <View style={styles.options}>
            <View style={styles.secondaryActions}>
              <Action label={t('more.support')} helper={t('more.opensMail')} busy={busyAction === 'support'} onPress={() => void run('support', onOpenSupport)} palette={palette} />
              <Action label={t('more.privacy')} helper={t('more.opensOutside')} busy={busyAction === 'privacy'} onPress={() => void run('privacy', onOpenPrivacy)} palette={palette} />
              <Action label={t('more.terms')} helper={t('more.opensOutside')} busy={busyAction === 'terms'} onPress={() => void run('terms', onOpenTerms)} palette={palette} />
              {status === 'sign-out-failed' ? (
                <Action label={t('access.retrySignOut')} busy={busyAction === 'retrySignOut'} onPress={() => void run('retrySignOut', onRetrySignOut)} palette={palette} />
              ) : (
                <Action label={t('access.signOut')} busy={busyAction === 'signOut'} onPress={() => void run('signOut', onLogout)} palette={palette} />
              )}
            </View>
            {failedAction ? (
              <Text accessibilityRole="alert" allowFontScaling style={[styles.failure, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.muted }]}>
                {t('access.actionFailed')}
              </Text>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function Action({ label, helper, onPress, palette, busy = false, primary = false }: {
  label: string
  helper?: string
  onPress?: () => void | Promise<void>
  palette: Palette
  busy?: boolean
  primary?: boolean
}) {
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={helper ? `${label}, ${helper}` : label}
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={() => void onPress?.()}
      style={({ pressed }) => [styles.action, primary ? [styles.primaryAction, { backgroundColor: palette.primary, borderColor: palette.primary }] : styles.secondaryAction, focused && { borderWidth: 2, borderColor: palette.foreground }, (pressed || busy) && styles.pressed]}
    >
      <View style={styles.actionText}>
         <Text allowFontScaling style={[styles.actionLabel, { color: primary ? palette.background : palette.foreground }]}>{label}</Text>
         {helper ? <Text allowFontScaling style={[styles.actionHelper, { color: primary ? palette.background : palette.mutedForeground }]}>{helper}</Text> : null}
      </View>
      <Text accessible={false} style={[styles.actionMark, { color: primary ? palette.primaryForeground : palette.foreground }]}>›</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', padding: themeTokens.layout.screenPadding },
  panel: { width: '100%', maxWidth: 520, alignSelf: 'center', alignItems: 'flex-start', gap: themeTokens.spacing[4] },
  marker: { width: 36, height: 2, borderRadius: themeTokens.radius.pill },
  title: { ...textStyles.title },
  message: { ...textStyles.body, maxWidth: 480 },
  options: { width: '100%', gap: themeTokens.spacing[3], marginTop: themeTokens.spacing[2] },
  secondaryActions: { width: '100%', gap: themeTokens.spacing[1] },
  action: { minWidth: themeTokens.touchTarget.minimum, minHeight: themeTokens.touchTarget.minimum, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[4], padding: themeTokens.spacing[3] },
  primaryAction: { borderWidth: 1, borderRadius: themeTokens.radius.md },
  secondaryAction: { borderRadius: themeTokens.radius.md },
  actionText: { flex: 1, gap: themeTokens.spacing[1] },
  actionLabel: { ...textStyles.bodyStrong, fontWeight: '600' as const },
  actionHelper: { ...textStyles.meta },
  actionMark: { ...textStyles.title, fontWeight: '400' as const },
  failure: { ...textStyles.body, borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4] },
  pressed: { opacity: 0.72 },
})
