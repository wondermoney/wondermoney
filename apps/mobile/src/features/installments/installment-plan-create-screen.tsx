import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollView, StyleSheet, View } from 'react-native'

import { AmountEntry } from '@/components/ui/amount-entry'
import { Amount } from '@/components/ui/amount'
import { DateField, formatIsoDate } from '@/components/ui/date-field'
import { FormBar } from '@/components/ui/form-bar'
import { FormGroup, FormTextRow } from '@/components/ui/form-row'
import { List, ListRow } from '@/components/ui/list-row'
import { Notice } from '@/components/ui/notice'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Section } from '@/components/ui/section'
import { Text } from '@/components/ui/text'
import { formatNumberInput, parseNumberInput } from '@/lib/formatters/decimal-input'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import {
  installmentPlanCreateSchema,
  MAX_INSTALLMENTS,
  MIN_INSTALLMENTS,
  splitInstallments,
  type InstallmentPlanCreate,
} from './installments-contract'
import type { InstallmentWriteFailure } from './use-installment-plan-mutations'

/** What a detected suggestion fills the form with; its links go with the plan unchanged. */
export type InstallmentPlanDraft = Readonly<{
  description: string
  purchaseDate: string
  totalAmount: number
  installmentCount: number
  links: NonNullable<InstallmentPlanCreate['links']>
}>

export type InstallmentPlanCreateScreenProps = Readonly<{
  accountId: number
  currency: string | null
  /** Pre-fills the form from a detected suggestion. */
  draft?: InstallmentPlanDraft | null
  /** The suggestion the form was opened for is gone (accepted elsewhere, or its rows changed). */
  suggestionUnavailable?: boolean
  pending: boolean
  failure: InstallmentWriteFailure | null
  onClose: () => void
  onSubmit: (payload: InstallmentPlanCreate) => void | Promise<void>
}>

const today = () => formatIsoDate(new Date())

/**
 * A purchase paid in installments on a card, typed in or accepted from a suggestion: the total big
 * and centred, then description, purchase day and the number of installments, and a preview of
 * how the API will split the total. Nothing is saved until ✓.
 */
export function InstallmentPlanCreateScreen({ accountId, currency, draft = null, suggestionUnavailable = false, pending, failure, onClose, onSubmit }: InstallmentPlanCreateScreenProps) {
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const [total, setTotal] = useState(draft ? formatNumberInput(draft.totalAmount, locale) : '')
  const [description, setDescription] = useState(draft?.description ?? '')
  const [purchaseDate, setPurchaseDate] = useState<string | null>(draft?.purchaseDate ?? today())
  const [installments, setInstallments] = useState(draft ? String(draft.installmentCount) : '')
  const links = draft?.links ?? []

  const totalAmount = total.trim() ? parseNumberInput(total, locale) : null
  const installmentCount = /^\d+$/.test(installments.trim()) ? Number(installments.trim()) : null
  // A linked transaction has to fit the schedule: "7/12" cannot go on a plan of six.
  const highestLinked = links.reduce((max, link) => Math.max(max, link.installmentNumber), 0)
  const candidate = {
    accountKey: accountId,
    description: description.trim(),
    purchaseDate: purchaseDate ?? '',
    totalAmount: totalAmount ?? Number.NaN,
    installmentCount: installmentCount ?? Number.NaN,
    ...(links.length > 0 ? { links } : {}),
  }
  const parsed = installmentPlanCreateSchema.safeParse(candidate)
  const countFits = installmentCount !== null && installmentCount >= highestLinked
  const ready = parsed.success && countFits

  const totalError = total.trim() !== '' && !installmentPlanCreateSchema.shape.totalAmount.safeParse(totalAmount ?? Number.NaN).success
    ? t('installments.create.errors.total')
    : null
  const countError = installments.trim() === ''
    ? null
    : !installmentPlanCreateSchema.shape.installmentCount.safeParse(installmentCount ?? Number.NaN).success
      ? t('installments.create.errors.count', { min: MIN_INSTALLMENTS, max: MAX_INSTALLMENTS })
      : !countFits ? t('installments.create.errors.countLinks', { number: highestLinked }) : null

  const preview = totalAmount !== null && installmentCount !== null && !totalError && !countError
    ? splitInstallments(totalAmount, installmentCount)
    : []

  const save = () => {
    if (!ready || pending || !parsed.success) return
    void onSubmit(parsed.data)
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <FormBar
        closeDisabled={pending}
        closeLabel={t('common.close')}
        onClose={onClose}
        onSave={save}
        saveDisabled={!ready || pending}
        saveLabel={pending ? t('installments.create.saving') : t('installments.create.save')}
        saving={pending}
        testID="installment-plan-create"
        title={draft ? t('installments.create.fromSuggestionTitle') : t('installments.create.title')}
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.page}>
          {suggestionUnavailable ? <Notice message={t('installments.suggestions.unavailable')} testID="installment-suggestion-unavailable" /> : null}
          <AmountEntry
            accessibilityLabel={t('installments.total')}
            caption={t('installments.total')}
            currency={currency}
            editable={!pending}
            error={totalError}
            locale={locale}
            onChangeText={setTotal}
            value={total}
          />
          <FormGroup>
            <FormTextRow autoCapitalize="sentences" editable={!pending} key="description" label={t('installments.create.description')} maxLength={255} onChangeText={setDescription} value={description} />
            <DateField appearance="row" disabled={pending} key="date" label={t('installments.create.purchaseDate')} onChange={setPurchaseDate} value={purchaseDate} />
            <FormTextRow
              editable={!pending}
              error={countError}
              key="count"
              keyboardType="number-pad"
              label={t('installments.create.count')}
              maxLength={3}
              onChangeText={setInstallments}
              placeholder={`${MIN_INSTALLMENTS}–${MAX_INSTALLMENTS}`}
              testID="installment-plan-count"
              value={installments}
            />
          </FormGroup>
          {links.length > 0 ? <Text tone="muted" variant="meta">{t('installments.create.links', { count: links.length })}</Text> : null}
          {failure ? <Notice message={t(`installments.failures.${failure}`)} testID="installment-plan-create-failure" tone="destructive" /> : null}

          {preview.length > 0 && currency ? (
            <Section title={t('installments.create.previewTitle')} variant="open" testID="installment-plan-preview">
              <PreviewRows amounts={preview} currency={currency} locale={locale} />
              <Text tone="muted" variant="label">{t('installments.projectionNote')}</Text>
            </Section>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

/**
 * The split at a glance: the API's rule gives every installment the same amount except, at
 * most, the last, so the preview is one row for the run and one for the last.
 */
function PreviewRows({ amounts, currency, locale }: { amounts: number[]; currency: string; locale: string }) {
  const { t } = useTranslation()
  const count = amounts.length
  const first = amounts[0]!
  const last = amounts[count - 1]!
  const sameLast = last === first
  const run = sameLast ? count : count - 1
  return (
    <List>
      <ListRow
        figure={<Amount currency={currency} locale={locale} value={first} />}
        meta={[t('installments.create.each')]}
        testID="installment-plan-preview-run"
        title={run === 1 ? t('installments.badgeLabel', { number: 1, total: count }) : t('installments.create.range', { from: 1, to: run, total: count })}
      />
      {sameLast ? null : (
        <ListRow
          figure={<Amount currency={currency} locale={locale} value={last} />}
          meta={[t('installments.create.remainder')]}
          separated
          testID="installment-plan-preview-last"
          title={t('installments.badgeLabel', { number: count, total: count })}
        />
      )}
    </List>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[10] },
  page: { width: '100%', maxWidth: 720, alignSelf: 'center', gap: themeTokens.spacing[4] },
})
