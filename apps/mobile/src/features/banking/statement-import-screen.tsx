import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import type { StatementImportPhase } from './use-statement-import'


export type StatementImportAccountOption = Readonly<{ accountId: number; name: null | string }>

export type StatementImportAccountsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'invalid-response' }
  | { status: 'loaded'; accounts: readonly StatementImportAccountOption[] }

export type StatementImportScreenProps = Readonly<{
  accountsState: StatementImportAccountsState
  selectedAccountId: null | number
  onSelectAccount: (accountId: number) => void
  onRetryAccounts: () => void | Promise<void>
  state: StatementImportPhase
  onPickFile: () => void | Promise<void>
  onReset: () => void
  onBack: () => void
}>

const BUSY_PHASES: ReadonlySet<StatementImportPhase['phase']> = new Set(['uploading', 'processing'])

export function StatementImportScreen({ accountsState, selectedAccountId, onSelectAccount, onRetryAccounts, state, onPickFile, onReset, onBack }: StatementImportScreenProps) {
  const { t } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const busy = BUSY_PHASES.has(state.phase)

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.page}>
          <Button label={t('banking.statementImport.back')} onPress={onBack} palette={palette} secondary disabled={busy} />
          <View style={styles.heading}>
            <Text accessibilityRole="header" allowFontScaling style={[styles.title, { color: palette.foreground }]}>{t('banking.statementImport.title')}</Text>
            <Text allowFontScaling style={[styles.helper, { color: palette.mutedForeground }]}>{t('banking.statementImport.helper')}</Text>
          </View>

          {state.phase === 'idle' ? (
            <AccountPicker
              accountsState={accountsState}
              selectedAccountId={selectedAccountId}
              onSelectAccount={onSelectAccount}
              onRetryAccounts={onRetryAccounts}
              palette={palette}
            />
          ) : null}

          {state.phase === 'idle' ? (
            <Button
              label={t('banking.statementImport.chooseFile')}
              onPress={onPickFile}
              palette={palette}
              disabled={selectedAccountId === null}
            />
          ) : null}

          {busy ? (
            <Text accessibilityRole="progressbar" accessibilityLabel={t(`banking.statementImport.phases.${state.phase}`)} allowFontScaling style={[styles.helper, { color: palette.mutedForeground }]}>
              {t(`banking.statementImport.phases.${state.phase}`)}
            </Text>
          ) : null}

          {state.phase === 'succeeded' ? (
            <View style={styles.form}>
              <Text accessibilityRole="alert" allowFontScaling style={[styles.success, { color: palette.foreground }]}>
                {state.summary ? t('banking.statementImport.succeeded', { count: state.summary.importedRows }) : t('banking.statementImport.succeededUnknownCount')}
              </Text>
              <Button label={t('banking.statementImport.done')} onPress={onBack} palette={palette} />
            </View>
          ) : null}

          {state.phase === 'failed' ? (
            <View style={styles.form}>
              <Text accessibilityRole="alert" allowFontScaling style={[styles.alert, { color: palette.destructive }]}>
                {t(`banking.statementImport.failures.${state.reason}`)}
              </Text>
              <Button label={t('banking.statementImport.tryAgain')} onPress={onReset} palette={palette} />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function AccountPicker({ accountsState, selectedAccountId, onSelectAccount, onRetryAccounts, palette }: {
  accountsState: StatementImportAccountsState
  selectedAccountId: null | number
  onSelectAccount: (accountId: number) => void
  onRetryAccounts: () => void | Promise<void>
  palette: Palette
}) {
  const { t } = useTranslation()

  if (accountsState.status === 'loading') {
    return <Text accessibilityRole="progressbar" accessibilityLabel={t('banking.statementImport.accounts.loading')} allowFontScaling style={[styles.helper, { color: palette.mutedForeground }]}>{t('banking.statementImport.accounts.loading')}</Text>
  }
  if (accountsState.status !== 'loaded') {
    return (
      <View style={styles.form}>
        <Text accessibilityRole="alert" allowFontScaling style={[styles.alert, { color: palette.destructive }]}>{t(`banking.statementImport.accounts.${accountsState.status}`)}</Text>
        <Button label={t('common.retry')} onPress={onRetryAccounts} palette={palette} />
      </View>
    )
  }
  if (accountsState.accounts.length === 0) {
    return <View style={[styles.empty, { borderColor: palette.border, backgroundColor: palette.muted }]}>
      <Text accessibilityRole="header" allowFontScaling style={[styles.label, { color: palette.foreground }]}>{t('banking.statementImport.accounts.emptyTitle')}</Text>
      <Text allowFontScaling style={[styles.helper, { color: palette.mutedForeground }]}>{t('banking.statementImport.accounts.empty')}</Text>
    </View>
  }
  return (
    <View style={styles.picker}>
      <Text allowFontScaling style={[styles.label, { color: palette.foreground }]}>{t('banking.statementImport.accounts.pick')}</Text>
      {accountsState.accounts.map((account) => (
        <Pressable
          key={account.accountId}
          accessible
          accessibilityRole="radio"
          accessibilityLabel={account.name ?? t('banking.statementImport.accounts.unnamed')}
          accessibilityState={{ selected: selectedAccountId === account.accountId }}
          onPress={() => onSelectAccount(account.accountId)}
          style={[
            styles.accountChoice,
            { borderColor: selectedAccountId === account.accountId ? palette.primary : palette.border, backgroundColor: selectedAccountId === account.accountId ? palette.primarySoft : palette.background },
          ]}
        >
          <Text allowFontScaling style={[styles.body, { color: palette.foreground }]}>{account.name ?? t('banking.statementImport.accounts.unnamed')}</Text>
        </Pressable>
      ))}
    </View>
  )
}

function Button({ label, onPress, palette, secondary = false, disabled = false }: { label: string; onPress: () => void | Promise<void>; palette: Palette; secondary?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => void onPress()}
      style={({ pressed }) => [
        styles.button,
        { borderColor: palette.primary, backgroundColor: secondary ? 'transparent' : palette.primary },
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text allowFontScaling style={[styles.buttonText, { color: secondary ? palette.primary : palette.background }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding },
  page: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: themeTokens.layout.blockGap },
  heading: { gap: themeTokens.spacing[2] },
  title: { ...textStyles.title, fontWeight: '700' as const },
  helper: { ...textStyles.body },
  label: { ...textStyles.bodyStrong, fontWeight: '600' as const },
  body: { ...textStyles.body },
  picker: { gap: themeTokens.spacing[3] },
  accountChoice: { minHeight: themeTokens.touchTarget.minimum, justifyContent: 'center', borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[4] },
  form: { gap: themeTokens.spacing[4] },
  empty: { borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4], gap: themeTokens.spacing[2] },
  alert: { ...textStyles.body },
  success: { ...textStyles.action },
  button: { minHeight: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[4], alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  buttonText: { ...textStyles.action, fontWeight: '700' as const },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.72 },
})
