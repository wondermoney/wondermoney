import { type Href, useNavigation, useRouter } from 'expo-router'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { ApiError } from '@/lib/api/errors'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import { OfflineAccountCreateScreen } from './offline-account-create-screen'
import { classifyOfflineAccountCreateFailure, useCreateOfflineAccount } from './use-create-offline-account'
import { useOfflineAccountOptions } from './use-offline-account-options'

export function OfflineAccountCreateRoute() {
  const options = useOfflineAccountOptions()
  const create = useCreateOfflineAccount()
  const router = useRouter()
  const navigation = useNavigation()
  const navigationUnlocked = useRef(false)

  useEffect(() => navigation.addListener('beforeRemove', (event) => {
    if (create.isPending && !navigationUnlocked.current) event.preventDefault()
  }), [create.isPending, navigation])

  if (options.isAccessTransition) return null
  if ((!options.currencies.data || !options.institutions.data) && !create.unknownGuard) {
    const invalid = options.error instanceof ApiError && options.error.code === 'invalid-response'
    return <OptionsState loading={options.isLoading} invalid={invalid} onBack={() => router.replace('/accounts' as Href)} onRetry={options.refetch} />
  }

  return <OfflineAccountCreateScreen
    currencies={options.currencies.data?.currencies ?? []}
    institutions={options.institutions.data?.accountFinancialInstitutions ?? []}
    pending={create.isPending}
    unknownGuard={create.unknownGuard}
    onBack={() => router.replace('/accounts' as Href)}
    onConfirm={async (payload) => {
      try {
        await create.mutateAsync(payload)
        navigationUnlocked.current = true
        router.replace('/accounts' as Href)
        return null
      } catch (error) {
        return classifyOfflineAccountCreateFailure(error)
      }
    }}
    onCheckAccounts={async () => {
      await create.reconcile()
      router.replace('/accounts' as Href)
    }}
    onCreateAnother={create.clearUnknownGuard}
  />
}

function OptionsState({ loading, invalid, onBack, onRetry }: { loading: boolean; invalid: boolean; onBack: () => void; onRetry: () => Promise<void> }) {
  const { t } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  return <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}><View style={styles.center}>
    <Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>{loading ? t('offlineAccount.loading') : t(invalid ? 'offlineAccount.optionsInvalid' : 'offlineAccount.optionsError')}</Text>
    {!loading ? <><Text accessibilityRole="alert" style={[styles.helper, { color: palette.mutedForeground }]}>{t(invalid ? 'offlineAccount.optionsInvalidMessage' : 'offlineAccount.optionsErrorMessage')}</Text><Pressable accessibilityRole="button" accessibilityLabel={t('common.retry')} onPress={() => void onRetry()} style={[styles.button, { borderColor: palette.primary, backgroundColor: palette.primary }]}><Text style={[styles.buttonText, { color: palette.background }]}>{t('common.retry')}</Text></Pressable></> : null}
    <Pressable accessibilityRole="button" accessibilityLabel={t('offlineAccount.back')} onPress={onBack} style={[styles.button, { borderColor: palette.primary }]}><Text style={[styles.buttonText, { color: palette.primary }]}>{t('offlineAccount.back')}</Text></Pressable>
  </View></SafeAreaView>
}

const styles = StyleSheet.create({ safe: { flex: 1 }, center: { flex: 1, width: '100%', maxWidth: 520, alignSelf: 'center', justifyContent: 'center', gap: themeTokens.spacing[4], padding: themeTokens.layout.screenPadding }, title: { ...textStyles.title }, helper: { ...textStyles.body }, button: { minHeight: themeTokens.touchTarget.minimum, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[4] }, buttonText: { ...textStyles.action } })
