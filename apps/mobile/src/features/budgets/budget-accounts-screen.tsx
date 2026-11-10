import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { accountMark, EntityMark } from '@/components/ui/entity-mark'
import { FormBar } from '@/components/ui/form-bar'
import { Icon } from '@/components/ui/icon'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Text as UiText } from '@/components/ui/text'
import { FormNotice } from '@/features/transactions/form-field'
import { themeTokens, type Palette } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { BudgetFailure, BudgetLoading } from './budgets-screen'
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
  const palette = usePalette()
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
      <FormBar
        closeDisabled={pending}
        closeLabel={t('common.close')}
        onClose={onBack}
        onSave={() => void onSubmit([...selected])}
        saveDisabled={!dirty || pending}
        saveLabel={pending ? t('budgetAccounts.saving') : t('budgetAccounts.save')}
        saving={pending}
        title={t('budgetAccounts.title')}
      />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.page}>
          <UiText tone="muted" variant="meta">{t('budgetAccounts.helper')}</UiText>
          {failure ? <FormNotice tone="destructive">{t(`budgetAccounts.failures.${failure}`)}</FormNotice> : null}
          {accounts.length === 0 ? (
            <UiText tone="muted" variant="body">{t('budgetAccounts.none')}</UiText>
          ) : (
            <View accessibilityRole="list" style={[styles.list, { borderColor: palette.border }]}>
              {accounts.map((account, index) => (
                <AccountCheckRow
                  key={account.id}
                  checked={selected.has(account.id)}
                  disabled={pending}
                  first={index === 0}
                  label={account.name ?? t('accounts.unnamed')}
                  onPress={() => toggle(account.id)}
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

/** One account as a 56pt form row: its mark, its name, and a checkbox on the right. */
function AccountCheckRow({ label, checked, disabled, first, onPress }: { label: string; checked: boolean; disabled: boolean; first: boolean; onPress: () => void }) {
  const palette = usePalette()
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !first && { borderTopWidth: 1, borderTopColor: palette.border },
        focused && { borderWidth: 2, borderColor: palette.ring, borderRadius: themeTokens.radius.xl },
        pressed && { backgroundColor: palette.muted },
        disabled && styles.disabled,
      ]}
    >
      <EntityMark {...accountMark({ institutionName: null, type: null })} size="sm" />
      <UiText numberOfLines={2} style={styles.rowLabel} variant="body">{label}</UiText>
      <View style={[styles.checkbox, { borderColor: checked ? palette.primary : palette.input, backgroundColor: checked ? palette.primary : 'transparent' }]}>
        {checked ? <Icon color={palette.primaryForeground} name="check" size={themeTokens.size.iconSmall} weight="semibold" /> : null}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[10] },
  page: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: themeTokens.spacing[4] },
  list: { borderWidth: 1, borderRadius: themeTokens.radius.xl, overflow: 'hidden' },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[3], paddingHorizontal: themeTokens.spacing[4], paddingVertical: themeTokens.spacing[2] },
  rowLabel: { flex: 1 },
  checkbox: { width: 24, height: 24, borderWidth: 2, borderRadius: themeTokens.radius.sm, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.5 },
})
