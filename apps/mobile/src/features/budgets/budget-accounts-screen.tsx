import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button } from '@/components/ui/button'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import { BudgetFailure, BudgetHeader, BudgetLoading } from './budgets-screen'
import type { BudgetAccountsWriteFailure } from './use-budget-accounts-mutation'

export type BudgetAccountOption = Readonly<{ id: number; name: string | null }>

export type BudgetAccountsScreenProps = Readonly<{
  status: 'loading' | 'error' | 'ready'
  accounts: readonly BudgetAccountOption[]
  linkedIds: readonly number[]
  pending: boolean
  failure: BudgetAccountsWriteFailure | null
  onBack: () => void
  onRefresh: () => void | Promise<void>
  onSubmit: (accountKeys: readonly number[]) => Promise<void>
}>

export function BudgetAccountsScreen(props: BudgetAccountsScreenProps) {
  const { t } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  if (props.status === 'loading') return <BudgetLoading label={t('budgetAccounts.loading')} palette={palette} />
  if (props.status === 'error') return <BudgetFailure title={t('budgetAccounts.errorTitle')} message={t('budgetAccounts.errorMessage')} onRetry={props.onRefresh} onBack={props.onBack} palette={palette} />
  return <BudgetAccountsForm key={props.linkedIds.join(',')} {...props} palette={palette} />
}

function BudgetAccountsForm({ accounts, linkedIds, pending, failure, onBack, onSubmit, palette }: Omit<BudgetAccountsScreenProps, 'status' | 'onRefresh'> & { palette: Palette }) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set(linkedIds))
  const dirty = selected.size !== linkedIds.length || linkedIds.some((id) => !selected.has(id))

  const toggle = (id: number) => {
    if (pending) return
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.page}>
          <BudgetHeader title={t('budgetAccounts.title')} backLabel={t('budgetAccounts.back')} onBack={onBack} disabled={pending} palette={palette} />
          {failure ? <Text accessibilityRole="alert" style={[styles.alert, { color: palette.foreground, borderColor: palette.destructive }]}>{t(`budgetAccounts.failures.${failure}`)}</Text> : null}
          {accounts.length === 0 ? (
            <Text style={[styles.empty, { color: palette.mutedForeground, borderColor: palette.border }]}>{t('budgetAccounts.none')}</Text>
          ) : (
            <View accessibilityRole="list" style={styles.list}>
              {accounts.map((account, index) => {
                const checked = selected.has(account.id)
                const label = account.name ?? t('accounts.unnamed')
                return (
                  <Pressable
                    key={account.id}
                    accessibilityRole="checkbox"
                    accessibilityLabel={label}
                    accessibilityState={{ checked, disabled: pending }}
                    disabled={pending}
                    onPress={() => toggle(account.id)}
                    style={({ pressed }) => [styles.row, index > 0 && { borderTopWidth: 1, borderTopColor: palette.border }, (pressed || pending) && styles.pressed]}
                  >
                    <View style={[styles.checkbox, { borderColor: checked ? palette.primary : palette.border, backgroundColor: checked ? palette.primary : 'transparent' }]}>
                      <Text accessible={false} style={[styles.checkmark, { color: palette.background }]}>{checked ? '✓' : ''}</Text>
                    </View>
                    <Text allowFontScaling style={[styles.rowLabel, { color: palette.foreground }]}>{label}</Text>
                  </Pressable>
                )
              })}
            </View>
          )}
          <Button disabled={!dirty || pending} label={pending ? t('budgetAccounts.saving') : t('budgetAccounts.save')} onPress={() => onSubmit([...selected])} palette={palette} variant="primary" />
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, content: { flexGrow: 1, padding: themeTokens.layout.screenPadding }, page: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: themeTokens.layout.blockGap },
  alert: { ...textStyles.body, borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4] },
  empty: { ...textStyles.body, borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4] },
  list: { borderWidth: 1, borderRadius: themeTokens.radius.lg, overflow: 'hidden' },
  row: { minHeight: themeTokens.touchTarget.minimum, flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[3], paddingHorizontal: themeTokens.spacing[4], paddingVertical: themeTokens.spacing[3] },
  checkbox: { width: 24, height: 24, borderWidth: 2, borderRadius: themeTokens.radius.sm, alignItems: 'center', justifyContent: 'center' },
  checkmark: { ...textStyles.action, fontWeight: '700' as const },
  rowLabel: { ...textStyles.body, flex: 1 },
  pressed: { opacity: 0.68 },
})
