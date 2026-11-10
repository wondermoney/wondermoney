import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native'

import { BackControl } from '@/components/ui/back-control'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { FormNotice } from './form-field'

import { GENERIC_CSV_COLUMNS, GENERIC_CSV_OPTIONAL_COLUMNS, rowsFailedCounts, type TransactionImportFlow } from './generic-csv-format'
import { SelectField } from './select-field'
import type { TransactionImportPhase } from './use-transaction-import'

export type TransactionImportAccountOption = Readonly<{ id: number; name: string }>
export type TransactionImportTypeCode = Readonly<{ code: number; label: string }>
export type TemplateShareStatus = 'idle' | 'sharing' | 'error'

export type TransactionImportScreenProps = Readonly<{
  state: TransactionImportPhase
  accounts: readonly TransactionImportAccountOption[]
  accountsLoading: boolean
  selectedAccountId: number | null
  /** The selected account's import flow; `null` while no account is selected. */
  flow: TransactionImportFlow | null
  bankName: string | null
  typeCodes: readonly TransactionImportTypeCode[]
  templateStatus: TemplateShareStatus
  onShareTemplate: () => void | Promise<void>
  onSelectAccount: (accountId: number) => void
  onPickFile: () => void | Promise<void>
  onReset: () => void
  onBack: () => void
}>

const BUSY_PHASES: ReadonlySet<TransactionImportPhase['phase']> = new Set(['uploading', 'starting', 'processing'])
const ROWS_CREATED_OUTCOMES: ReadonlySet<string> = new Set(['succeeded', 'partial'])

export function TransactionImportScreen({
  state,
  accounts,
  accountsLoading,
  selectedAccountId,
  flow,
  bankName,
  typeCodes,
  templateStatus,
  onShareTemplate,
  onSelectAccount,
  onPickFile,
  onReset,
  onBack,
}: TransactionImportScreenProps) {
  const { t } = useTranslation()
  const palette = usePalette()
  const busy = BUSY_PHASES.has(state.phase)
  const rowsFailed = state.phase === 'done' ? rowsFailedCounts(state.format, state.outcome, state.rows) : null

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.page}>
          <BackControl fallback="/accounts/transactions" onPress={onBack} disabled={busy} />
          <PageHeader title={t('transactionImport.title')} instruction={t('transactionImport.helper')} />

          {state.phase === 'idle' ? (
            <View style={styles.form}>
              {accountsLoading ? <Text accessibilityRole="progressbar" tone="muted" variant="meta">{t('transactionImport.accountsLoading')}</Text> : null}
              {!accountsLoading && accounts.length === 0 ? <Text tone="muted" variant="meta">{t('transactionImport.noAccounts')}</Text> : null}
              {accounts.length > 0 ? (
                <SelectField
                  label={t('transactionImport.account')}
                  onChange={onSelectAccount}
                  options={accounts.map((account) => ({ value: account.id, label: account.name }))}
                  placeholder={t('transactionImport.chooseAccount')}
                  value={selectedAccountId}
                />
              ) : null}
              {flow === 'generic' ? (
                <GenericFormat typeCodes={typeCodes} templateStatus={templateStatus} onShareTemplate={onShareTemplate} />
              ) : null}
              {flow === 'bank' ? <Text tone="muted" variant="meta">{t('transactionImport.bankFormat', { bank: bankName ?? t('transactionImport.yourBank') })}</Text> : null}
              {flow === 'legacy' ? <Text tone="muted" variant="meta">{t('transactionImport.legacyFormat')}</Text> : null}
              {flow === 'unknown' ? <FormNotice tone="destructive">{t('transactionImport.unknownFormat')}</FormNotice> : null}
              <Button block icon="upload" label={t('transactionImport.chooseFile')} onPress={onPickFile} disabled={selectedAccountId === null || flow === 'unknown'} />
            </View>
          ) : null}

          {busy ? (
            <View accessible accessibilityRole="progressbar" accessibilityLabel={t(`transactionImport.phases.${state.phase}`)} style={styles.progress}>
              <ActivityIndicator color={palette.mutedForeground} size="small" />
              <Text tone="muted" variant="meta">{t(`transactionImport.phases.${state.phase}`)}</Text>
            </View>
          ) : null}

          {state.phase === 'done' ? (
            <View style={styles.form}>
              <Text accessibilityRole="alert" tone={ROWS_CREATED_OUTCOMES.has(state.outcome) ? 'default' : 'destructive'} variant="bodyStrong">
                {t(`transactionImport.outcomes.${state.outcome}`)}
              </Text>
              {rowsFailed ? <Text tone="muted" variant="meta">{t('transactionImport.generic.rowsFailed', rowsFailed)}</Text> : null}
              <View style={styles.actions}>
                <Button block label={t('transactionImport.done')} onPress={onBack} />
                <Button block label={t('transactionImport.importAnother')} onPress={onReset} variant="outline" />
              </View>
            </View>
          ) : null}

          {state.phase === 'error' ? (
            <View style={styles.form}>
              <FormNotice tone="destructive">{t(`transactionImport.failures.${state.reason}`)}</FormNotice>
              <Button block label={t('transactionImport.tryAgain')} onPress={onReset} />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

/**
 * The generic CSV's columns. A background step (muted), not a bordered box,
 * so it reads as part of the form rather than a card inside it.
 */
function GenericFormat({ typeCodes, templateStatus, onShareTemplate }: {
  typeCodes: readonly TransactionImportTypeCode[]
  templateStatus: TemplateShareStatus
  onShareTemplate: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const palette = usePalette()
  const [showTypeCodes, setShowTypeCodes] = useState(false)
  return (
    <View testID="transaction-import-generic-format" style={[styles.panel, { backgroundColor: palette.muted }]}>
      <Text variant="meta">{t('transactionImport.generic.intro')}</Text>
      {GENERIC_CSV_COLUMNS.map((column) => (
        <View key={column} style={styles.column}>
          <Text variant="amount">
            {column}
            {GENERIC_CSV_OPTIONAL_COLUMNS.has(column) ? <Text tone="muted" variant="label">{` (${t('transactionImport.generic.optional')})`}</Text> : null}
          </Text>
          <Text tone="muted" variant="label">{t(`transactionImport.generic.columns.${column}`)}</Text>
        </View>
      ))}
      <View style={styles.inlineActions}>
        <Button
          disabled={templateStatus === 'sharing'}
          label={t(templateStatus === 'sharing' ? 'transactionImport.generic.templateSharing' : 'transactionImport.generic.template')}
          loading={templateStatus === 'sharing'}
          onPress={onShareTemplate}
          size="sm"
          variant="secondary"
        />
        {typeCodes.length > 0 ? (
          <Button
            label={t(showTypeCodes ? 'transactionImport.generic.hideTypeCodes' : 'transactionImport.generic.showTypeCodes')}
            onPress={() => setShowTypeCodes((shown) => !shown)}
            size="sm"
            variant="ghost"
          />
        ) : null}
      </View>
      {templateStatus === 'error' ? <Text accessibilityRole="alert" tone="destructive" variant="meta">{t('transactionImport.generic.templateFailed')}</Text> : null}
      {showTypeCodes ? (
        <View accessibilityLabel={t('transactionImport.generic.typeCodes')} style={styles.typeCodes}>
          {typeCodes.map((type) => (
            <View key={type.code} style={styles.typeCode}>
              <Text style={styles.code} variant="amount">{String(type.code)}</Text>
              <Text style={styles.typeLabel} tone="muted" variant="meta">{type.label}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[8] },
  page: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: themeTokens.spacing[6] },
  form: { gap: themeTokens.spacing[4] },
  progress: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2] },
  panel: { gap: themeTokens.spacing[3], borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4] },
  column: { gap: 2 },
  typeCodes: { gap: themeTokens.spacing[1] },
  typeCode: { flexDirection: 'row', gap: themeTokens.spacing[3] },
  code: { minWidth: 32 },
  typeLabel: { flex: 1 },
  actions: { gap: themeTokens.spacing[2] },
  inlineActions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
})
