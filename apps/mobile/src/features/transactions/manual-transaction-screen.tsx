import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollView, StyleSheet, View } from 'react-native'
import { AmountEntry } from '@/components/ui/amount-entry'
import { Button } from '@/components/ui/button'
import { DateField } from '@/components/ui/date-field'
import { accountMark, EntityMark } from '@/components/ui/entity-mark'
import { FormBar } from '@/components/ui/form-bar'
import { FormGroup, FormRow, FormRowNote, FormSelectRow, FormTextRow } from '@/components/ui/form-row'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Text } from '@/components/ui/text'

import { SafeAreaView } from '@/components/ui/screen-safe-area'
import type { AccountSummaryViewModel } from '@/features/accounts/accounts-view-model'
import type { CategoryViewModel } from '@/features/categories/categories-view-model'
import { TagPickerSheet, type CreateTagOutcome, type TagsState } from '@/features/tags/tag-picker-sheet'
import type { TagDto } from '@/features/tags/tags-contract'
import { parseAmountInput } from '@/lib/formatters/decimal-input'
import { useFormatMoney } from '@/lib/formatters/money-display'
import { themeTokens, type Palette } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import {
  freezeManualTransaction,
  transactionDirection,
  type FrozenManualTransaction,
  type SettlementCurrencyDto,
  type TransactionMerchantDto,
  type TransactionTypeDto,
} from './manual-transaction-contract'
import type { ManualTransactionFailure } from './use-create-manual-transaction'
import {
  defaultTypeOfKind,
  formatManualTransactionType,
  manualTransactionKinds,
  typesOfKind,
  type ManualTransactionKind,
} from './manual-transaction-types'
import { FormNotice } from './form-field'


export type ManualTransactionScreenProps = Readonly<{
  accounts: readonly AccountSummaryViewModel[]
  categories: readonly CategoryViewModel[]
  /** Household tags. Not loaded (or an older server), the Tags row stays hidden. */
  tags?: TagsState
  onCreateTag?: (name: string) => Promise<CreateTagOutcome>
  types: readonly TransactionTypeDto[]
  currencies: readonly SettlementCurrencyDto[]
  merchants: readonly TransactionMerchantDto[]
  merchantSearchStatus: 'loading' | 'error' | 'loaded'
  initialAccountId: number | null
  loading: boolean
  metadataError: boolean
  pending: boolean
  outcome: ManualTransactionFailure | null
  onMerchantSearch: (value: string) => void
  onBack: () => void
  onEdit: () => void
  onSubmit: (value: FrozenManualTransaction) => Promise<void>
  onInspect: (value: FrozenManualTransaction) => void
}>

const localToday = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** The typed amount as the API takes it (a dot decimal), read in the app's language; `null` unless it is positive. */
const positiveAmount = (value: string, locale: string) => {
  const parsed = parseAmountInput(value, locale)
  return parsed !== null && Number(parsed) > 0 ? parsed : null
}

/** A real calendar day, written `YYYY-MM-DD`, that is not after today. */
function isPastOrPresentDay(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return false
  return value <= localToday()
}

/** The kind the form opens on: Expense, unless the server offers no expense type. */
function initialKind(types: readonly TransactionTypeDto[]): ManualTransactionKind {
  return manualTransactionKinds.find((kind) => typesOfKind(types, kind).length > 0) ?? 'expense'
}

/**
 * Add transaction, as a calm-structure flow: the form bar (close, save), the
 * amount big and centred, Expense | Income | Transfer, then one group of
 * rows. Save reviews first: the ✓ freezes the details into a review, and the
 * ✓ on the review records them, so nothing is sent before it is confirmed.
 */
export function ManualTransactionScreen({
  accounts,
  categories,
  tags = { status: 'loading' },
  onCreateTag,
  types,
  currencies,
  merchants,
  merchantSearchStatus,
  initialAccountId,
  loading,
  metadataError,
  pending,
  outcome,
  onMerchantSearch,
  onBack,
  onEdit,
  onSubmit,
  onInspect,
}: ManualTransactionScreenProps) {
  const formatMoney = useFormatMoney()
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const [accountId, setAccountId] = useState<number | null>(initialAccountId)
  const [date, setDate] = useState(localToday)
  const [kind, setKind] = useState<ManualTransactionKind>(() => initialKind(types))
  const [typeId, setTypeId] = useState<number | null>(() => defaultTypeOfKind(types, initialKind(types))?.transactionTypeKey ?? null)
  const [amount, setAmount] = useState('')
  const [currencyId, setCurrencyId] = useState<number | null>(null)
  const [selectedExistingMerchant, setSelectedExistingMerchant] = useState<TransactionMerchantDto | null>(null)
  const [merchantName, setMerchantName] = useState('')
  const [createMerchantIntent, setCreateMerchantIntent] = useState(false)
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [tagIds, setTagIds] = useState<readonly number[]>([])
  // Tags created in the picker this visit, so their names show before the list refetches.
  const [createdTags, setCreatedTags] = useState<readonly TagDto[]>([])
  const [tagsOpen, setTagsOpen] = useState(false)
  const [description, setDescription] = useState('')
  const [notes, setNotes] = useState('')
  const [frozen, setFrozen] = useState<FrozenManualTransaction | null>(null)
  const [validationError, setValidationError] = useState(false)
  const allCategories = useMemo(() => categories.flatMap((category) => [category, ...category.children]), [categories])

  const account = accounts.find((item) => item.accountId === accountId)
  const accountOptions = useMemo(() => accounts.map((item) => ({
    value: item.accountId,
    label: item.accountName ?? t('accounts.unnamed'),
    leading: <EntityMark {...accountMark({ logoUrl: item.institutionLogoUrl, institutionName: item.institutionDisplayName, type: item.accountType })} size="sm" />,
  })), [accounts, t])
  // The settlement currency follows the account until someone picks another.
  const accountCurrencyId = currencies.find((item) => item.code === account?.originalCurrencyCode)?.currencyKey ?? null
  const effectiveCurrencyId = currencyId ?? accountCurrencyId

  const selectedAccount = accounts.find((item) => item.accountId === (frozen?.accountId ?? accountId))
  const selectedType = types.find((item) => item.transactionTypeKey === Number(frozen?.payload.transactionTypeId ?? typeId))
  const selectedCurrency = currencies.find((item) => item.currencyKey === Number(frozen?.payload.settlementCurrencyId ?? effectiveCurrencyId))
  const selectedMerchant = frozen?.payload.transactionMerchantId
    ? selectedExistingMerchant?.transactionMerchantKey === frozen.payload.transactionMerchantId
      ? selectedExistingMerchant
      : merchants.find((item) => item.transactionMerchantKey === frozen.payload.transactionMerchantId)
    : selectedExistingMerchant
  const knownTags = tags.status === 'loaded' ? [...tags.tags, ...createdTags] : createdTags
  const tagNames = (ids: readonly number[]) => ids
    .map((key) => knownTags.find((tag) => tag.tagKey === key)?.name)
    .filter((value): value is string => Boolean(value))
    .join(', ')
  const createTagForForm = async (name: string): Promise<CreateTagOutcome> => {
    if (!onCreateTag) return { error: '' }
    const outcome = await onCreateTag(name)
    if ('tag' in outcome) setCreatedTags((current) => [...current, outcome.tag])
    return outcome
  }
  const selectedCategory = allCategories.find((item) => item.id === Number(frozen?.payload.categoryId ?? categoryId))
  const trimmedMerchantName = merchantName.trim()
  const conclusiveNoMatch = merchantSearchStatus === 'loaded' && trimmedMerchantName.length > 0 && merchants.length === 0
  const canUseNewMerchant = trimmedMerchantName.length > 0 && (createMerchantIntent || conclusiveNoMatch)
  const merchantIntentMissing = selectedExistingMerchant === null && !canUseNewMerchant
  const merchantChoices = selectedExistingMerchant && !merchants.some((item) => item.transactionMerchantKey === selectedExistingMerchant.transactionMerchantKey)
    ? [selectedExistingMerchant, ...merchants]
    : merchants

  // Errors show for what was entered and is wrong; a field not filled yet only
  // keeps the ✓ disabled.
  const normalizedAmount = positiveAmount(amount, locale) ?? ''
  const amountValid = normalizedAmount !== ''
  const amountError = amount.trim() !== '' && !amountValid ? t('transactionCreate.errors.amount') : null
  const dateValid = isPastOrPresentDay(date)
  const dateError = date !== '' && !dateValid ? t('transactionCreate.errors.date') : null
  const formReady = accountId !== null && typeId !== null && amountValid && effectiveCurrencyId !== null && dateValid && !merchantIntentMissing

  const review = () => {
    setValidationError(false)
    try {
      setFrozen(freezeManualTransaction({
        accountId: accountId as number,
        transactionDate: date,
        transactionTypeId: typeId as number,
        settlementAmount: normalizedAmount,
        settlementCurrencyId: effectiveCurrencyId as number,
        existingMerchantId: selectedExistingMerchant?.transactionMerchantKey,
        newMerchantName: canUseNewMerchant ? merchantName : '',
        categoryId,
        tagIds,
        description,
        notes,
      }))
    } catch {
      setValidationError(true)
    }
  }

  if (loading) return <StatePage palette={palette} title={t('transactionCreate.loading')} onBack={onBack} progress />
  if (metadataError) return <StatePage palette={palette} title={t('transactionCreate.metadataError')} onBack={onBack} />

  const direction = selectedType ? transactionDirection(selectedType.name) : null
  const localizedType = selectedType ? formatManualTransactionType(t, selectedType.name) : ''
  const merchantLabel = selectedMerchant?.name ?? frozen?.payload.transactionMerchantName ?? merchantName.trim()
  const formattedAmount = frozen && selectedCurrency
    ? formatMoney(Number(frozen.payload.settlementAmount), { locale, currency: selectedCurrency.code })
    : null
  const kinds = manualTransactionKinds.filter((item) => typesOfKind(types, item).length > 0)
  const chooseKind = (next: ManualTransactionKind) => {
    if (next === kind) return
    setKind(next)
    setTypeId(defaultTypeOfKind(types, next)?.transactionTypeKey ?? null)
  }
  const todayIso = localToday()
  const formatDay = (day: Date) => {
    const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    return iso === todayIso ? t('transactionCreate.today') : new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(day)
  }
  const confirmable = outcome === null || outcome === 'cancelled'

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <FormBar
        closeDisabled={pending}
        closeLabel={t('common.close')}
        onClose={onBack}
        onSave={frozen ? () => void onSubmit(frozen) : review}
        saveDisabled={frozen ? !confirmable : !formReady || pending}
        saveLabel={frozen ? (pending ? t('transactionCreate.submitting') : t('transactionCreate.confirm')) : t('transactionCreate.review')}
        saving={frozen !== null && pending}
        title={t('transactionCreate.title')}
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.page}>
          {frozen ? (
            <View style={styles.form}>
              <View style={styles.reviewHead}>
                <Text accessibilityRole="header" variant="heading">{t(outcome === 'unknown' ? 'transactionCreate.unknown.title' : 'transactionCreate.reviewTitle')}</Text>
                {outcome === 'unknown' ? <FormNotice tone="destructive">{t('transactionCreate.unknown.message')}</FormNotice> : <Text tone="muted" variant="meta">{t('transactionCreate.reviewHelper')}</Text>}
              </View>
              <View style={[styles.reviewList, { borderColor: palette.border }]}>
                <ReviewRow label={t('transactionCreate.amount')} value={formattedAmount ?? ''} data first />
                <ReviewRow label={t('transactionCreate.type')} value={selectedType ? t('transactionCreate.typeValue', { type: localizedType, direction: t(`transactions.${direction}`) }) : ''} />
                <ReviewRow label={t('transactionCreate.account')} value={selectedAccount?.accountName ?? t('accounts.unnamed')} />
                <ReviewRow label={t('transactionCreate.merchant')} value={merchantLabel} />
                {selectedCategory ? <ReviewRow label={t('transactionCreate.category')} value={selectedCategory.name} /> : null}
                {frozen.payload.tagIds && frozen.payload.tagIds.length > 0 ? <ReviewRow label={t('tags.title')} value={tagNames(frozen.payload.tagIds)} /> : null}
                {frozen.payload.description ? <ReviewRow label={t('transactionCreate.description')} value={frozen.payload.description} /> : null}
                {frozen.payload.notes ? <ReviewRow label={t('transactionCreate.note')} value={frozen.payload.notes} /> : null}
                <ReviewRow label={t('transactionCreate.date')} value={new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(frozen.payload.transactionDate))} />
              </View>
              <Text tone={direction === 'credit' ? 'success' : 'destructive'} variant="bodyStrong">{t(`transactionCreate.effect.${direction}`, { amount: formattedAmount })}</Text>
              {outcome && outcome !== 'unknown' ? <FormNotice>{t(`transactionCreate.result.${outcome}`)}</FormNotice> : null}
              <View style={styles.reviewActions}>
                {outcome === 'unknown'
                  ? <Button label={t('transactionCreate.unknown.inspect')} onPress={() => onInspect(frozen)} />
                  : <Button label={t('transactionCreate.edit')} onPress={() => { setFrozen(null); onEdit() }} disabled={pending} variant="secondary" />}
              </View>
            </View>
          ) : (
            <View style={styles.form}>
              <AmountEntry
                accessibilityLabel={t('transactionCreate.amount')}
                allowExpressions
                currency={selectedCurrency?.code ?? null}
                editable={!pending}
                error={amountError}
                locale={locale}
                onChangeText={setAmount}
                value={amount}
              />
              {kinds.length > 1 ? (
                <SegmentedControl
                  accessibilityLabel={t('transactionCreate.kindLabel')}
                  fill
                  onChange={chooseKind}
                  options={kinds.map((item) => ({ value: item, label: t(`transactionCreate.kinds.${item}`) }))}
                  value={kind}
                />
              ) : null}
              <FormGroup>
                <FormSelectRow key="account" disabled={pending} label={t('transactionCreate.account')} onChange={setAccountId} options={accountOptions} placeholder={t('transactionCreate.choose')} value={accountId} />
                <FormSelectRow key="type" accessibilityLabel={t('transactionCreate.type')} disabled={pending} label={t('transactionCreate.typeShort')} onChange={setTypeId} options={typesOfKind(types, kind).map((item) => ({ value: item.transactionTypeKey, label: formatManualTransactionType(t, item.name) }))} placeholder={t('transactionCreate.choose')} sheetTitle={t('transactionCreate.type')} value={typeId} />
                <FormSelectRow key="currency" accessibilityLabel={t('transactionCreate.currency')} disabled={pending} label={t('transactionCreate.currencyShort')} onChange={setCurrencyId} options={currencies.map((item) => ({ value: item.currencyKey, label: `${item.code}${item.description ? ` · ${item.description}` : ''}` }))} placeholder={t('transactionCreate.choose')} sheetTitle={t('transactionCreate.currency')} value={effectiveCurrencyId} />
                {/* 0 stands for "no category": category ids are positive. */}
                <FormSelectRow key="category" accessibilityLabel={t('transactionCreate.categoryOptional')} disabled={pending} label={t('transactionCreate.category')} onChange={(id) => setCategoryId(id === 0 ? null : id)} options={[{ value: 0, label: t('transactionCreate.noCategory') }, ...allCategories.map((item) => ({ value: item.id, label: item.name }))]} placeholder={t('transactionCreate.noCategory')} value={categoryId} />
                {tags.status === 'loaded' && onCreateTag ? (
                  <FormRow
                    key="tags"
                    accessibilityLabel={t('tags.optional')}
                    disabled={pending}
                    label={t('tags.title')}
                    onPress={() => setTagsOpen(true)}
                    placeholder={t('tags.none')}
                    value={tagNames(tagIds)}
                  />
                ) : null}
                <View key="merchant">
                  <FormTextRow
                    accessibilityLabel={t('transactionCreate.merchantSearch')}
                    editable={!pending}
                    label={t('transactionCreate.merchant')}
                    maxLength={200}
                    onChangeText={(value) => { setMerchantName(value); onMerchantSearch(value) }}
                    placeholder={t('transactionCreate.merchantRowPlaceholder')}
                    value={merchantName}
                  />
                  {merchantSearchStatus === 'loading' ? <Text accessibilityRole="progressbar" style={styles.note} tone="muted" variant="meta">{t('transactionCreate.merchantSearching')}</Text> : null}
                  {merchantSearchStatus === 'error' ? <FormRowNote alert>{t('transactionCreate.merchantSearchUnavailable')}</FormRowNote> : null}
                  {conclusiveNoMatch ? <FormRowNote>{t('transactionCreate.merchantNoMatches')}</FormRowNote> : null}
                  {trimmedMerchantName.length > 0 && !conclusiveNoMatch ? (
                    <View style={styles.note}>
                      <Button disabled={pending} icon={createMerchantIntent ? 'check' : 'plus'} label={t('transactionCreate.createNewMerchant')} onPress={() => { setSelectedExistingMerchant(null); setCreateMerchantIntent(true) }} size="sm" variant={createMerchantIntent ? 'outline' : 'secondary'} />
                    </View>
                  ) : null}
                </View>
                {merchantChoices.length > 0 ? (
                  <FormSelectRow
                    key="existing-merchant"
                    disabled={pending}
                    hint={selectedExistingMerchant ? t('transactionCreate.selectedMerchant', { merchant: selectedExistingMerchant.name }) : null}
                    label={t('transactionCreate.existingMerchant')}
                    onChange={(id) => { const merchant = merchantChoices.find((item) => item.transactionMerchantKey === id) ?? null; setSelectedExistingMerchant(merchant); if (merchant) setCreateMerchantIntent(false) }}
                    options={merchantChoices.map((item) => ({ value: item.transactionMerchantKey, label: item.name }))}
                    placeholder={t('transactionCreate.choose')}
                    value={selectedExistingMerchant?.transactionMerchantKey ?? null}
                  />
                ) : null}
                <FormTextRow key="description" accessibilityLabel={t('transactionCreate.descriptionOptional')} editable={!pending} label={t('transactionCreate.description')} maxLength={500} onChangeText={setDescription} placeholder={t('transactionCreate.optional')} value={description} />
                <FormTextRow key="notes" accessibilityLabel={t('transactionCreate.noteOptional')} editable={!pending} label={t('transactionCreate.note')} maxLength={1000} multiline onChangeText={setNotes} placeholder={t('transactionCreate.optional')} testID="transaction-create-notes" value={notes} />
                <DateField key="date" appearance="row" disabled={pending} error={dateError ?? undefined} formatValue={formatDay} label={t('transactionCreate.date')} maximumDate={todayIso} onChange={(value) => setDate(value ?? '')} value={date || null} />
              </FormGroup>
              {validationError ? <FormNotice tone="destructive">{t('transactionCreate.validation')}</FormNotice> : null}
            </View>
          )}
          {tagsOpen ? (
            <TagPickerSheet
              initial={tagIds}
              onClose={() => setTagsOpen(false)}
              onCreate={createTagForForm}
              onSave={(next) => { setTagIds(next); setTagsOpen(false) }}
              saveLabel={t('tags.done')}
              tags={tags.status === 'loaded' ? { status: 'loaded', tags: knownTags } : tags}
              title={t('tags.title')}
            />
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function ReviewRow({ label, value, data = false, first = false }: { label: string; value: string; data?: boolean; first?: boolean }) {
  const palette = usePalette()
  return (
    <View style={[styles.reviewRow, !first && { borderTopWidth: 1, borderTopColor: palette.border }]}>
      <Text style={styles.reviewLabel} variant="body">{label}</Text>
      <Text style={styles.reviewValue} variant={data ? 'amountBase' : 'body'}>{value}</Text>
    </View>
  )
}

function StatePage({ palette, title, onBack, progress = false }: { palette: Palette; title: string; onBack: () => void; progress?: boolean }) {
  const { t } = useTranslation()
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <FormBar closeLabel={t('common.close')} onClose={onBack} title={t('transactionCreate.title')} />
      <View style={styles.state}>
        <Text accessibilityRole={progress ? 'progressbar' : 'alert'} tone={progress ? 'muted' : 'default'} variant="meta">{title}</Text>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[10] },
  page: { width: '100%', maxWidth: 720, alignSelf: 'center' },
  form: { gap: themeTokens.spacing[4] },
  note: { paddingHorizontal: themeTokens.spacing[4], paddingBottom: themeTokens.spacing[3], alignItems: 'flex-start' },
  reviewHead: { gap: themeTokens.spacing[2], paddingTop: themeTokens.spacing[4] },
  reviewList: { borderWidth: 1, borderRadius: themeTokens.radius.xl },
  reviewRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[4], paddingHorizontal: themeTokens.spacing[4], paddingVertical: themeTokens.spacing[3] },
  reviewLabel: { flexShrink: 0 },
  reviewValue: { flexShrink: 1, textAlign: 'right' },
  reviewActions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
  state: { flex: 1, alignItems: 'flex-start', padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[4] },
})
