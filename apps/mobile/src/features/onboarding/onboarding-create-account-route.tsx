import { type Href, useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { OfflineAccountCreateScreen } from '@/features/accounts/offline-account-create-screen'
import { classifyOfflineAccountCreateFailure, useCreateOfflineAccount } from '@/features/accounts/use-create-offline-account'
import { useOfflineAccountOptions } from '@/features/accounts/use-offline-account-options'
import { ApiError } from '@/lib/api/errors'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import { useCompleteOnboarding } from './use-complete-onboarding'

/**
 * RAD-419 — the manual-account activation path from onboarding. Composes the
 * same building blocks as `OfflineAccountCreateRoute` (accounts tab entry
 * point) but with onboarding-specific navigation: back goes to `/onboarding`
 * instead of `/accounts`, and a successful creation completes onboarding
 * before landing in the authenticated shell instead of `/accounts` directly.
 *
 * Onboarding completion failing after a successful account creation is not
 * treated as a creation failure — the account is real and already synced.
 * The onboarding gate is idempotent, so a user in that edge case simply sees
 * the journey again next launch (with an account already visible) rather
 * than losing their work.
 */
function parseVersion(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (value === undefined) return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

export function OnboardingCreateAccountRoute() {
  const params = useLocalSearchParams<{ version?: string }>()
  const version = parseVersion(params.version)
  const options = useOfflineAccountOptions()
  // RAD-518 — the activation path: reaching this screen means onboarding is
  // still required, so a successful creation here is a first account by
  // construction rather than by guessing at a cached list.
  const create = useCreateOfflineAccount('onboarding')
  const completion = useCompleteOnboarding()
  const router = useRouter()
  const navigation = useNavigation()
  const navigationUnlocked = useRef(false)

  useEffect(() => navigation.addListener('beforeRemove', (event) => {
    if ((create.isPending || completion.isPending) && !navigationUnlocked.current) event.preventDefault()
  }), [create.isPending, completion.isPending, navigation])

  if (version === null) {
    return <InvalidVersionState onBack={() => router.replace('/onboarding' as Href)} />
  }

  if (options.isAccessTransition) return null
  if ((!options.currencies.data || !options.institutions.data) && !create.unknownGuard) {
    const invalid = options.error instanceof ApiError && options.error.code === 'invalid-response'
    return <OptionsState loading={options.isLoading} invalid={invalid} onBack={() => router.replace('/onboarding' as Href)} onRetry={options.refetch} />
  }

  return <OfflineAccountCreateScreen
    currencies={options.currencies.data?.currencies ?? []}
    institutions={options.institutions.data?.accountFinancialInstitutions ?? []}
    pending={create.isPending || completion.isPending}
    unknownGuard={create.unknownGuard}
    onBack={() => router.replace('/onboarding' as Href)}
    onConfirm={async (payload) => {
      try {
        await create.mutateAsync(payload)
      } catch (error) {
        return classifyOfflineAccountCreateFailure(error)
      }
      try {
        await completion.mutateAsync({ version })
      } catch {
        // See file header: the account was created, so we still proceed.
      }
      navigationUnlocked.current = true
      router.replace('/' as Href)
      return null
    }}
    onCheckAccounts={async () => {
      await create.reconcile()
      navigationUnlocked.current = true
      router.replace('/' as Href)
    }}
    onCreateAnother={create.clearUnknownGuard}
  />
}

function InvalidVersionState({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <View style={styles.center}>
        <Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>{t('onboarding.createAccount.invalidVersion.title')}</Text>
        <Text accessibilityRole="alert" style={[styles.helper, { color: palette.mutedForeground }]}>{t('onboarding.createAccount.invalidVersion.message')}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t('onboarding.createAccount.back')} onPress={onBack} style={[styles.button, { borderColor: palette.primary }]}>
          <Text style={[styles.buttonText, { color: palette.primary }]}>{t('onboarding.createAccount.back')}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

function OptionsState({ loading, invalid, onBack, onRetry }: { loading: boolean; invalid: boolean; onBack: () => void; onRetry: () => Promise<void> }) {
  const { t } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  return <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}><View style={styles.center}>
    <Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>{loading ? t('offlineAccount.loading') : t(invalid ? 'offlineAccount.optionsInvalid' : 'offlineAccount.optionsError')}</Text>
    {!loading ? <><Text accessibilityRole="alert" style={[styles.helper, { color: palette.mutedForeground }]}>{t(invalid ? 'offlineAccount.optionsInvalidMessage' : 'offlineAccount.optionsErrorMessage')}</Text><Pressable accessibilityRole="button" accessibilityLabel={t('common.retry')} onPress={() => void onRetry()} style={[styles.button, { borderColor: palette.primary, backgroundColor: palette.primary }]}><Text style={[styles.buttonText, { color: palette.background }]}>{t('common.retry')}</Text></Pressable></> : null}
    <Pressable accessibilityRole="button" accessibilityLabel={t('onboarding.createAccount.back')} onPress={onBack} style={[styles.button, { borderColor: palette.primary }]}><Text style={[styles.buttonText, { color: palette.primary }]}>{t('onboarding.createAccount.back')}</Text></Pressable>
  </View></SafeAreaView>
}

const styles = StyleSheet.create({ safe: { flex: 1 }, center: { flex: 1, width: '100%', maxWidth: 520, alignSelf: 'center', justifyContent: 'center', gap: themeTokens.spacing[4], padding: themeTokens.layout.screenPadding }, title: { ...textStyles.title }, helper: { ...textStyles.body }, button: { minHeight: themeTokens.touchTarget.minimum, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[4] }, buttonText: { ...textStyles.action } })
