import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { Amount } from '@/components/ui/amount'
import { BackControl } from '@/components/ui/back-control'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { List, ListRow } from '@/components/ui/list-row'
import { PageHeader } from '@/components/ui/page-header'
import { ProgressBar } from '@/components/ui/progress-bar'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { FormNotice } from './form-field'
import { SelectField } from './select-field'
import type { TransactionImportDecision } from './transaction-import-contract'
import {
  isDecidableFilter,
  isMappingComplete,
  type ReviewFilter,
  type ReviewFilterOption,
  type ReviewRowModel,
  type TransactionImportStage,
} from './transaction-import-review-view-model'
import type { TransactionImportFailure } from './use-transaction-import'

export type TransactionImportMappingModel = Readonly<{
  sources: readonly Readonly<{ label: string; rowCount: number }>[]
  accounts: readonly Readonly<{ id: number; name: string }>[]
  initial: Readonly<Record<string, number>>
}>

export type TransactionImportReviewScreenProps = Readonly<{
  locale: string
  /** The name the file had; `null` for an import started without one (it is named by its day). */
  fileName: string | null
  createdAt: string | null
  /** `null` until the session is first read. */
  stage: TransactionImportStage | null
  loadFailed: boolean
  rows: readonly ReviewRowModel[]
  filter: ReviewFilter
  filters: readonly ReviewFilterOption[]
  page: number
  pages: number
  /** Rows the commit will write. */
  toImport: number
  canCommit: boolean
  /** A write is in flight; the review takes no other. */
  busy: boolean
  committing: boolean
  /** A demo profile is read-only: every write is off. */
  locked: boolean
  failure: TransactionImportFailure | null
  /** The order a QIF file's dates were read in, when the file did not say. */
  dateOrder: 'day-first' | 'month-first' | null
  /** The file's accounts to map, while one has no account. */
  mapping: TransactionImportMappingModel | null
  onFilterChange: (filter: ReviewFilter) => void
  onPageChange: (page: number) => void
  onDecideRow: (rowId: number, decision: TransactionImportDecision) => void
  onDecideAll: (decision: TransactionImportDecision) => void
  onSaveMapping: (mapping: Record<string, number>) => void
  onDateOrder: (order: 'day-first' | 'month-first') => void
  onCommit: () => void
  onRetryRead: () => void
  onCancel: () => void
  onRetryLoad: () => void
  onDone: () => void
  onImportAnother: () => void
  onBack: () => void
}>

/** A row date (an ISO timestamp) as its calendar day, wherever the reader is, with the year (web's review). */
function formatDay(iso: string, locale: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number)
  const date = new Date(year ?? Number.NaN, (month ?? 1) - 1, day ?? 1)
  return Number.isNaN(date.getTime()) ? iso : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date)
}

/**
 * The review step of a staged import (web's TransactionImportReview at phone width): the file's
 * rows by status, each included or skipped, one by one or a whole status at once; an account per
 * source account when the file holds several; then the commit, which runs in the background and
 * can be retried where it stopped. Nothing is written until the person presses the commit.
 */
export function TransactionImportReviewScreen(props: TransactionImportReviewScreenProps) {
  const { t } = useTranslation()
  const palette = usePalette()
  const { stage, locale } = props
  const writesOff = props.busy || props.locked
  const reviewing = stage?.kind === 'review'

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content} testID="transaction-import-review">
        <View style={styles.page}>
          <BackControl fallback="/accounts/transactions" onPress={props.onBack} />
          <PageHeader title={t('transactionImport.title')} />

          {stage && props.createdAt !== null ? (
            <Text numberOfLines={1} testID="transaction-import-name" variant="metaStrong">
              {props.fileName ?? t('transactionImport.review.unnamed', { date: formatDay(props.createdAt, locale) })}
            </Text>
          ) : null}

          {stage === null && !props.loadFailed ? <Working label={t('transactionImport.review.reading')} /> : null}
          {stage === null && props.loadFailed ? (
            <View style={styles.block}>
              <FormNotice tone="destructive">{t('transactionImport.review.loadFailed')}</FormNotice>
              <Button block label={t('transactionImport.tryAgain')} onPress={props.onRetryLoad} />
            </View>
          ) : null}

          {props.failure ? <FormNotice tone="destructive" testID="transaction-import-review-failure">{t(`transactionImport.failures.${props.failure}`)}</FormNotice> : null}

          {stage?.kind === 'reading' ? (
            stage.stalled ? (
              <View style={styles.block}>
                <Text accessibilityRole="alert" variant="meta">{t('transactionImport.review.readStalled')}</Text>
                <View style={styles.actions}>
                  <Button block disabled={writesOff} label={t('transactionImport.tryAgain')} onPress={props.onRetryRead} />
                  <Button block disabled={writesOff} label={t('transactionImport.review.cancel')} onPress={props.onCancel} variant="ghost" />
                </View>
              </View>
            ) : <Working label={t('transactionImport.review.reading')} />
          ) : null}

          {stage?.kind === 'importing' ? <Importing stage={stage} disabled={writesOff} onRetry={props.onCommit} /> : null}

          {stage?.kind === 'done' ? <Outcome stage={stage} onDone={props.onDone} onImportAnother={props.onImportAnother} /> : null}

          {stage?.kind === 'read-failed' || stage?.kind === 'expired' || stage?.kind === 'unsupported' ? (
            <View style={styles.block}>
              <FormNotice tone={stage.kind === 'read-failed' ? 'destructive' : 'default'}>
                {t(stage.kind === 'read-failed' ? 'transactionImport.review.readFailed' : stage.kind === 'expired' ? 'transactionImport.review.expired' : 'transactionImport.review.unsupported')}
              </FormNotice>
              <View style={styles.actions}>
                {stage.kind === 'unsupported' ? null : <Button block label={t('transactionImport.importAnother')} onPress={props.onImportAnother} />}
                <Button block label={t('transactionImport.done')} onPress={props.onDone} variant={stage.kind === 'unsupported' ? 'primary' : 'outline'} />
              </View>
            </View>
          ) : null}

          {stage?.kind === 'needs-web' ? (
            <View style={styles.block}>
              <FormNotice>{t(stage.reason === 'pdf' ? 'transactionImport.review.needsWebPdf' : 'transactionImport.review.needsWeb')}</FormNotice>
              <Button block disabled={writesOff} label={t('transactionImport.review.cancel')} onPress={props.onCancel} />
            </View>
          ) : null}

          {reviewing ? (
            <View style={styles.block} testID="transaction-import-review-rows">
              <Text tone="muted" variant="meta">{t('transactionImport.review.summary')}</Text>

              {props.mapping ? <AccountMapping disabled={writesOff} mapping={props.mapping} onSave={props.onSaveMapping} /> : null}

              {props.dateOrder ? (
                <View style={[styles.panel, { backgroundColor: palette.muted }]}>
                  <Text accessibilityRole="header" variant="metaStrong">{t('transactionImport.review.dateOrderTitle')}</Text>
                  <Text tone="muted" variant="meta">{t(props.dateOrder === 'month-first' ? 'transactionImport.review.dateOrderHintMonthFirst' : 'transactionImport.review.dateOrderHintDayFirst')}</Text>
                  <View style={styles.inlineActions}>
                    <Button disabled={writesOff} label={t('transactionImport.review.dayFirst')} onPress={() => props.onDateOrder('day-first')} size="sm" variant="outline" />
                    <Button disabled={writesOff} label={t('transactionImport.review.monthFirst')} onPress={() => props.onDateOrder('month-first')} size="sm" variant="outline" />
                  </View>
                </View>
              ) : null}

              <SegmentedControl
                accessibilityLabel={t('transactionImport.review.filter')}
                onChange={props.onFilterChange}
                options={props.filters.map((option) => ({ value: option.value, label: t(`transactionImport.review.filters.${option.value}`, { count: option.count }) }))}
                scrollable
                size="sm"
                value={props.filter}
              />

              {isDecidableFilter(props.filter) ? (
                <View style={styles.inlineActions}>
                  <Button disabled={writesOff} label={t('transactionImport.review.includeAll')} onPress={() => props.onDecideAll('import')} size="sm" variant="outline" />
                  <Button disabled={writesOff} label={t('transactionImport.review.skipAll')} onPress={() => props.onDecideAll('skip')} size="sm" variant="outline" />
                </View>
              ) : null}

              {props.rows.length === 0 ? <Text tone="muted" variant="meta">{t('transactionImport.review.empty')}</Text> : (
                <List divided>
                  {props.rows.map((row) => <ReviewRow disabled={writesOff} key={row.id} locale={locale} onDecide={props.onDecideRow} row={row} />)}
                </List>
              )}

              {props.pages > 1 ? (
                <View style={styles.pager}>
                  <Button disabled={props.page <= 1} label={t('transactionImport.review.previous')} onPress={() => props.onPageChange(props.page - 1)} size="sm" variant="ghost" />
                  <Text tone="muted" variant="meta">{t('transactionImport.review.page', { page: props.page, pages: props.pages })}</Text>
                  <Button disabled={props.page >= props.pages} label={t('transactionImport.review.next')} onPress={() => props.onPageChange(props.page + 1)} size="sm" variant="ghost" />
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      </ScrollView>

      {reviewing ? (
        <View style={[styles.footer, { borderTopColor: palette.border, backgroundColor: palette.background }]}>
          <Button
            block
            disabled={writesOff || !props.canCommit}
            label={props.toImport === 0 ? t('transactionImport.review.commitNothing') : t('transactionImport.review.commit', { count: props.toImport })}
            loading={props.committing}
            onPress={props.onCommit}
          />
          <Button block disabled={writesOff} label={t('transactionImport.review.cancel')} onPress={props.onCancel} variant="ghost" />
        </View>
      ) : null}
    </SafeAreaView>
  )
}

function Working({ label }: { label: string }) {
  const palette = usePalette()
  return (
    <View accessible accessibilityLabel={label} accessibilityRole="progressbar" style={styles.progress}>
      <ActivityIndicator color={palette.mutedForeground} size="small" />
      <Text tone="muted" variant="meta">{label}</Text>
    </View>
  )
}

/** The commit's progress, rows written of rows to write; a stopped job is asked again and carries on. */
function Importing({ stage, disabled, onRetry }: { stage: Extract<TransactionImportStage, { kind: 'importing' }>; disabled: boolean; onRetry: () => void }) {
  const { t } = useTranslation()
  const palette = usePalette()
  if (stage.stalled) {
    return (
      <View style={styles.block}>
        <Text accessibilityRole="alert" variant="meta">{t('transactionImport.review.stalled')}</Text>
        <Button block disabled={disabled} label={t('transactionImport.tryAgain')} onPress={onRetry} />
      </View>
    )
  }
  const label = t('transactionImport.review.importing', { imported: stage.imported, total: stage.total })
  return (
    <View
      accessible
      accessibilityLabel={label}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: Math.max(stage.total, 1), now: stage.imported }}
      style={styles.block}
      testID="transaction-import-progress"
    >
      <ProgressBar color={palette.primary} value={stage.total > 0 ? (stage.imported / stage.total) * 100 : 0} />
      <Text tone="muted" variant="meta">{label}</Text>
    </View>
  )
}

function Outcome({ stage, onDone, onImportAnother }: { stage: Extract<TransactionImportStage, { kind: 'done' }>; onDone: () => void; onImportAnother: () => void }) {
  const { t } = useTranslation()
  return (
    <View style={styles.block}>
      <Text accessibilityRole="alert" tone={stage.outcome === 'failed' ? 'destructive' : 'default'} variant="bodyStrong">
        {t('transactionImport.review.done', { count: stage.imported, skipped: stage.skipped })}
      </Text>
      {stage.failed > 0 ? <Text tone="muted" variant="meta">{t('transactionImport.review.doneFailed', { count: stage.failed })}</Text> : null}
      {stage.detailsDeleted ? <Text tone="muted" variant="meta">{t('transactionImport.review.detailsDeleted')}</Text> : null}
      <View style={styles.actions}>
        <Button block label={t('transactionImport.done')} onPress={onDone} />
        <Button block label={t('transactionImport.importAnother')} onPress={onImportAnother} variant="outline" />
      </View>
    </View>
  )
}

function ReviewRow({ row, locale, disabled, onDecide }: { row: ReviewRowModel; locale: string; disabled: boolean; onDecide: (rowId: number, decision: TransactionImportDecision) => void }) {
  const { t } = useTranslation()
  const palette = usePalette()
  const rowLabel = t('transactionImport.review.row', { row: row.sourceRow })
  const status = row.status === 'unknown' ? null : t(`transactionImport.review.status.${row.status}`)
  return (
    <ListRow
      badge={status ? <Badge label={status} tone={row.status === 'new' ? 'outline' : 'muted'} /> : undefined}
      figure={row.amount !== null ? <Amount currency={row.currency} delta locale={locale} size="amount" value={row.amount} /> : undefined}
      leading={row.decidable ? (
        <Pressable
          accessibilityLabel={t('transactionImport.review.includeRow', { row: row.sourceRow })}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: row.included, disabled }}
          disabled={disabled}
          hitSlop={12}
          onPress={() => onDecide(row.id, row.included ? 'skip' : 'import')}
          style={({ pressed }) => [styles.checkbox, { borderColor: row.included ? palette.primary : palette.input, backgroundColor: row.included ? palette.primary : 'transparent' }, (pressed || disabled) && styles.dimmed]}
          testID={`transaction-import-row-${row.id}`}
        >
          {row.included ? <Icon color={palette.primaryForeground} name="check" size={14} weight="bold" /> : null}
        </Pressable>
      ) : <View style={styles.checkboxSpace} />}
      // A line that did not read is titled by its number; one that did shows its date.
      meta={[row.date ? formatDay(row.date, locale) : row.title ? rowLabel : null, row.error]}
      title={row.title ?? rowLabel}
    />
  )
}

/** Web's mapping fieldset: an account for each account in the file, saved together. */
function AccountMapping({ mapping, disabled, onSave }: { mapping: TransactionImportMappingModel; disabled: boolean; onSave: (mapping: Record<string, number>) => void }) {
  const { t } = useTranslation()
  const palette = usePalette()
  const [chosen, setChosen] = useState<Record<string, number>>(() => ({ ...mapping.initial }))
  const options = mapping.accounts.map((account) => ({ value: account.id, label: account.name }))
  return (
    <View style={[styles.panel, { backgroundColor: palette.muted }]} testID="transaction-import-mapping">
      <Text accessibilityRole="header" variant="metaStrong">{t('transactionImport.review.mappingTitle')}</Text>
      {mapping.sources.map((source) => (
        <SelectField
          disabled={disabled}
          key={source.label}
          label={t('transactionImport.review.mappingSource', { label: source.label, count: source.rowCount })}
          onChange={(accountId) => setChosen((current) => ({ ...current, [source.label]: accountId }))}
          options={options}
          placeholder={t('transactionImport.review.mappingChoose')}
          value={chosen[source.label] ?? null}
        />
      ))}
      <View style={styles.inlineActions}>
        <Button disabled={disabled || !isMappingComplete({ sourceAccounts: [...mapping.sources] }, chosen)} label={t('transactionImport.review.mappingSave')} onPress={() => onSave(chosen)} size="sm" />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[8] },
  page: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: themeTokens.spacing[6] },
  block: { gap: themeTokens.spacing[4] },
  actions: { gap: themeTokens.spacing[2] },
  inlineActions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
  progress: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2] },
  panel: { gap: themeTokens.spacing[3], borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4] },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[2] },
  footer: { gap: themeTokens.spacing[2], borderTopWidth: 1, paddingHorizontal: themeTokens.layout.screenPadding, paddingVertical: themeTokens.spacing[3] },
  checkbox: { width: 20, height: 20, borderWidth: 1, borderRadius: themeTokens.radius.sm, alignItems: 'center', justifyContent: 'center' },
  checkboxSpace: { width: 20 },
  dimmed: { opacity: 0.5 },
})
