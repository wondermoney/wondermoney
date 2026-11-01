import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BackControl } from '@/components/ui/back-control'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import { GENERIC_CSV_COLUMNS, GENERIC_CSV_OPTIONAL_COLUMNS, rowsFailedCounts, type TransactionImportFlow } from './generic-csv-format'
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
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const busy = BUSY_PHASES.has(state.phase)
  const rowsFailed = state.phase === 'done' ? rowsFailedCounts(state.format, state.outcome, state.rows) : null

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.page}>
          <View style={styles.header}>
            <BackControl fallback="/accounts" label={t('transactionImport.back')} onPress={onBack} disabled={busy} />
            <View style={styles.heading}>
              <Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>{t('transactionImport.title')}</Text>
              <Text style={[styles.helper, { color: palette.mutedForeground }]}>{t('transactionImport.helper')}</Text>
            </View>
          </View>

          {state.phase === 'idle' ? (
            <View style={styles.form}>
              <Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.foreground }]}>{t('transactionImport.account')}</Text>
              {accountsLoading ? <Text accessibilityRole="progressbar" style={[styles.helper, { color: palette.mutedForeground }]}>{t('transactionImport.accountsLoading')}</Text> : null}
              {!accountsLoading && accounts.length === 0 ? <Text style={[styles.helper, { color: palette.mutedForeground }]}>{t('transactionImport.noAccounts')}</Text> : null}
              <View style={styles.filters}>
                {accounts.map((account) => (
                  <Filter key={account.id} label={account.name} selected={selectedAccountId === account.id} palette={palette} onPress={() => onSelectAccount(account.id)} />
                ))}
              </View>
              {flow === 'generic' ? (
                <GenericFormat palette={palette} typeCodes={typeCodes} templateStatus={templateStatus} onShareTemplate={onShareTemplate} />
              ) : null}
              {flow === 'bank' ? <Text style={[styles.helper, { color: palette.mutedForeground }]}>{t('transactionImport.bankFormat', { bank: bankName ?? t('transactionImport.yourBank') })}</Text> : null}
              {flow === 'legacy' ? <Text style={[styles.helper, { color: palette.mutedForeground }]}>{t('transactionImport.legacyFormat')}</Text> : null}
              {flow === 'unknown' ? <Text accessibilityRole="alert" style={[styles.helper, { color: palette.destructive }]}>{t('transactionImport.unknownFormat')}</Text> : null}
              <Button label={t('transactionImport.chooseFile')} onPress={onPickFile} palette={palette} primary disabled={selectedAccountId === null || flow === 'unknown'} />
            </View>
          ) : null}

          {busy ? (
            <Text accessibilityRole="progressbar" accessibilityLabel={t(`transactionImport.phases.${state.phase}`)} style={[styles.helper, { color: palette.mutedForeground }]}>
              {t(`transactionImport.phases.${state.phase}`)}
            </Text>
          ) : null}

          {state.phase === 'done' ? (
            <View style={styles.form}>
              <Text accessibilityRole="alert" style={[styles.outcome, { color: ROWS_CREATED_OUTCOMES.has(state.outcome) ? palette.foreground : palette.destructive }]}>
                {t(`transactionImport.outcomes.${state.outcome}`)}
              </Text>
              {rowsFailed ? <Text style={[styles.helper, { color: palette.mutedForeground }]}>{t('transactionImport.generic.rowsFailed', rowsFailed)}</Text> : null}
              <View style={styles.actions}>
                <Button label={t('transactionImport.importAnother')} onPress={onReset} palette={palette} />
                <Button label={t('transactionImport.done')} onPress={onBack} palette={palette} primary />
              </View>
            </View>
          ) : null}

          {state.phase === 'error' ? (
            <View style={styles.form}>
              <Text accessibilityRole="alert" style={[styles.outcome, { color: palette.destructive }]}>{t(`transactionImport.failures.${state.reason}`)}</Text>
              <Button label={t('transactionImport.tryAgain')} onPress={onReset} palette={palette} primary />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function GenericFormat({ palette, typeCodes, templateStatus, onShareTemplate }: {
  palette: Palette
  typeCodes: readonly TransactionImportTypeCode[]
  templateStatus: TemplateShareStatus
  onShareTemplate: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const [showTypeCodes, setShowTypeCodes] = useState(false)
  return (
    <View testID="transaction-import-generic-format" style={[styles.panel, { borderColor: palette.border }]}>
      <Text style={[styles.helper, { color: palette.foreground }]}>{t('transactionImport.generic.intro')}</Text>
      {GENERIC_CSV_COLUMNS.map((column) => (
        <View key={column} style={styles.column}>
          <Text style={[styles.columnName, { color: palette.foreground }]}>
            {column}
            {GENERIC_CSV_OPTIONAL_COLUMNS.has(column) ? <Text style={{ color: palette.mutedForeground }}>{` (${t('transactionImport.generic.optional')})`}</Text> : null}
          </Text>
          <Text style={[styles.helper, { color: palette.mutedForeground }]}>{t(`transactionImport.generic.columns.${column}`)}</Text>
        </View>
      ))}
      <View style={styles.actions}>
        <Button
          label={t(templateStatus === 'sharing' ? 'transactionImport.generic.templateSharing' : 'transactionImport.generic.template')}
          onPress={onShareTemplate}
          palette={palette}
          disabled={templateStatus === 'sharing'}
        />
        {typeCodes.length > 0 ? (
          <Button
            label={t(showTypeCodes ? 'transactionImport.generic.hideTypeCodes' : 'transactionImport.generic.showTypeCodes')}
            onPress={() => setShowTypeCodes((shown) => !shown)}
            palette={palette}
            expanded={showTypeCodes}
          />
        ) : null}
      </View>
      {templateStatus === 'error' ? <Text accessibilityRole="alert" style={[styles.helper, { color: palette.destructive }]}>{t('transactionImport.generic.templateFailed')}</Text> : null}
      {showTypeCodes ? (
        <View accessibilityLabel={t('transactionImport.generic.typeCodes')} style={styles.typeCodes}>
          {typeCodes.map((type) => (
            <View key={type.code} style={styles.typeCode}>
              <Text style={[styles.columnName, styles.code, { color: palette.foreground }]}>{type.code}</Text>
              <Text style={[styles.helper, styles.typeLabel, { color: palette.mutedForeground }]}>{type.label}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  )
}

function Filter({ label, selected, palette, onPress }: { label: string; selected: boolean; palette: Palette; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={({ pressed }) => [styles.filter, { borderColor: selected ? palette.primary : palette.border, backgroundColor: selected ? palette.primarySoft : 'transparent' }, pressed && styles.pressed]}>
      <Text style={[styles.filterText, { color: selected ? palette.primary : palette.foreground }]}>{label}</Text>
    </Pressable>
  )
}

function Button({ label, onPress, palette, primary = false, disabled = false, expanded }: { label: string; onPress: () => void | Promise<void>; palette: Palette; primary?: boolean; disabled?: boolean; expanded?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled, busy: disabled, expanded }} disabled={disabled} onPress={() => void onPress()} style={({ pressed }) => [styles.button, { borderColor: primary ? 'transparent' : palette.input, backgroundColor: primary ? palette.primary : 'transparent' }, (pressed || disabled) && styles.pressed]}>
      <Text style={[styles.buttonText, { color: primary ? palette.primaryForeground : palette.foreground }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding },
  page: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: themeTokens.layout.blockGap },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: themeTokens.spacing[4] },
  heading: { flex: 1, minWidth: 220, gap: themeTokens.spacing[1] },
  title: { ...textStyles.title, fontWeight: '700' as const },
  helper: { ...textStyles.body },
  sectionTitle: { ...textStyles.section },
  outcome: { ...textStyles.action },
  form: { gap: themeTokens.spacing[4] },
  panel: { gap: themeTokens.spacing[3], borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4] },
  column: { gap: themeTokens.spacing[1] },
  columnName: { ...textStyles.bodyStrong },
  typeCodes: { gap: themeTokens.spacing[1] },
  typeCode: { flexDirection: 'row', gap: themeTokens.spacing[3] },
  code: { minWidth: 32, fontVariant: ['tabular-nums'] },
  typeLabel: { flex: 1 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
  filter: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderRadius: themeTokens.radius.pill, paddingHorizontal: themeTokens.spacing[4] },
  filterText: { ...textStyles.bodyStrong },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[3] },
  button: { minHeight: themeTokens.touchTarget.minimum, minWidth: themeTokens.touchTarget.minimum, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[4] },
  buttonText: { ...textStyles.action },
  pressed: { opacity: 0.65 },
})
