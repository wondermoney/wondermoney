import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { accountMark, EntityMark } from '@/components/ui/entity-mark'
import { FormBar } from '@/components/ui/form-bar'
import { FormGroup, FormRow, FormSelectRow, FormTextRow } from '@/components/ui/form-row'
import { Icon } from '@/components/ui/icon'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Text as UiText } from '@/components/ui/text'
import { FormNotice } from '@/features/transactions/form-field'
import { formatNumberInput } from '@/lib/formatters/decimal-input'
import { useFormatMoney } from '@/lib/formatters/money-display'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'
import { usePalette } from '@/theme/use-palette'

import {
  invalidOfflineAccountFields,
  offlineAccountPayloadSchema,
  parsePositiveDecimal,
  type AccountCurrencyDto,
  type AccountFinancialInstitutionDto,
  type OfflineAccountPayload,
} from './offline-account-contract'
import type { OfflineAccountCreateFailure, OfflineAccountUnknownGuard } from './use-create-offline-account'


export type OfflineAccountCreateScreenProps = {
  currencies: readonly AccountCurrencyDto[]
  institutions: readonly AccountFinancialInstitutionDto[]
  pending: boolean
  unknownGuard: OfflineAccountUnknownGuard | null
  onBack: () => void
  onConfirm: (payload: OfflineAccountPayload) => Promise<OfflineAccountCreateFailure | null>
  onCheckAccounts: () => Promise<void>
  onCreateAnother: () => void
}

export function OfflineAccountCreateScreen({
  currencies,
  institutions,
  pending,
  unknownGuard,
  onBack,
  onConfirm,
  onCheckAccounts,
  onCreateAnother,
}: OfflineAccountCreateScreenProps) {
  const formatMoney = useFormatMoney()
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const initial = unknownGuard?.payload
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const [name, setName] = useState(initial?.name ?? '')
  const [balance, setBalance] = useState(initial ? formatNumberInput(initial.currentBalance, locale) : '')
  const [currencyId, setCurrencyId] = useState<number | null>(initial?.currencyId ?? null)
  const [institutionId, setInstitutionId] = useState<number | null>(initial?.financialInstitutionId ?? null)
  const [reviewed, setReviewed] = useState<OfflineAccountPayload | null>(initial ?? null)
  const [phase, setPhase] = useState<'form' | 'review' | 'unknown'>(initial ? 'unknown' : 'form')
  const [failure, setFailure] = useState<OfflineAccountCreateFailure | null>(null)
  const [institutionQuery, setInstitutionQuery] = useState('')
  const [institutionOpen, setInstitutionOpen] = useState(false)
  const selectedCurrency = currencies.find((item) => item.currencyKey === (reviewed?.currencyId ?? currencyId))
  const selectedInstitution = institutions.find((item) => item.accountFinancialInstitutionKey === (reviewed?.financialInstitutionId ?? institutionId))

  const availableInstitutions = useMemo(() => institutions.map((item) => ({
    ...item,
    label: item.displayName ?? t('offlineAccount.institutionUnnamed'),
  })), [institutions, t])
  const filteredInstitutions = useMemo(() => {
    const query = institutionQuery.trim().toLocaleLowerCase()
    return query === '' ? availableInstitutions : availableInstitutions.filter((institution) => institution.label.toLocaleLowerCase().includes(query))
  }, [availableInstitutions, institutionQuery])

  // Re-derived on every render (not stored) so a field's error clears the
  // moment it's fixed.
  const shownInvalid = invalidOfflineAccountFields(name, balance, currencyId, currencies, locale)
  // The institution list is a fixed, UI-constrained choice — not covered by
  // invalidOfflineAccountFields — so a stale reference (e.g. from a resumed
  // unknownGuard payload whose institution no longer exists) has nowhere
  // field-level to surface and falls back to the old generic message.
  const institutionExists = institutionId === null || institutions.some((item) => item.accountFinancialInstitutionKey === institutionId)
  const showInstitutionError = !institutionExists

  const stageReview = () => {
    const amount = parsePositiveDecimal(balance, locale)
    if (shownInvalid.size > 0 || !institutionExists) return
    const result = offlineAccountPayloadSchema.safeParse({
      name,
      currentBalance: amount,
      currencyId,
      ...(institutionId === null ? {} : { financialInstitutionId: institutionId }),
    })
    if (!result.success) return
    setFailure(null)
    setReviewed(Object.freeze(result.data))
    setPhase('review')
  }

  const confirm = async () => {
    if (!reviewed || pending || phase === 'unknown') return
    setFailure(null)
    const result = await onConfirm(reviewed)
    if (result === 'unknown') setPhase('unknown')
    setFailure(result)
  }

  const createAnother = () => {
    onCreateAnother()
    setName('')
    setBalance('')
    setCurrencyId(null)
    setInstitutionId(null)
    setInstitutionQuery('')
    setReviewed(null)
    setFailure(null)
    setPhase('form')
  }

  const formReady = shownInvalid.size === 0 && institutionExists
  // Errors show for what was entered and is wrong; a field not filled yet only
  // keeps the ✓ disabled.
  const nameError = name.length > 0 && shownInvalid.has('name') ? t('offlineAccount.fieldErrors.name') : null
  const balanceError = balance.trim() !== '' && shownInvalid.has('balance') ? t('offlineAccount.fieldErrors.balance') : null
  const currencyError = currencyId !== null && shownInvalid.has('currency') ? t('offlineAccount.fieldErrors.currency') : null
  const editing = phase === 'form'

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <FormBar
        closeDisabled={pending}
        closeLabel={t('common.close')}
        onClose={onBack}
        onSave={editing ? stageReview : phase === 'review' ? () => void confirm() : undefined}
        saveDisabled={editing ? !formReady || pending : pending}
        saveLabel={editing ? t('offlineAccount.review') : pending ? t('offlineAccount.creating') : t('offlineAccount.confirm')}
        saving={!editing && pending}
        title={t('offlineAccount.title')}
      />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.page}>
          {editing ? <>
            <UiText tone="muted" variant="meta">{t('offlineAccount.helper')}</UiText>
            <FormGroup>
              <FormTextRow
                key="name"
                accessibilityLabel={t('offlineAccount.name')}
                autoCapitalize="sentences"
                editable={!pending}
                error={nameError}
                label={t('offlineAccount.name')}
                maxLength={100}
                onChangeText={setName}
                placeholder={t('offlineAccount.namePlaceholder')}
                value={name}
              />
              <FormRow
                key="institution"
                disabled={pending}
                error={showInstitutionError ? t('offlineAccount.validation.fields') : null}
                expanded={institutionOpen}
                label={t('offlineAccount.institution')}
                onPress={() => setInstitutionOpen(true)}
                placeholder={t('offlineAccount.none')}
                value={selectedInstitution ? (selectedInstitution.displayName ?? t('offlineAccount.institutionUnnamed')) : null}
                valueLeading={selectedInstitution ? <EntityMark {...accountMark({ logoUrl: selectedInstitution.logoUrl, institutionName: selectedInstitution.displayName, type: null })} size="sm" /> : undefined}
              />
              <FormTextRow
                key="balance"
                accessibilityLabel={t('offlineAccount.balance')}
                editable={!pending}
                error={balanceError}
                hint={t('offlineAccount.balanceHelper')}
                keyboardType="decimal-pad"
                label={t('offlineAccount.balance')}
                onChangeText={setBalance}
                placeholder="0.00"
                value={balance}
              />
              <FormSelectRow
                key="currency"
                disabled={pending}
                error={currencyError}
                label={t('offlineAccount.currency')}
                onChange={(value) => setCurrencyId(value)}
                options={currencies.map((currency) => ({ value: currency.currencyKey, label: `${currency.code} · ${currency.description}` }))}
                placeholder={t('transactionCreate.choose')}
                value={currencyId}
              />
            </FormGroup>
            <InstitutionSheet
              institutions={filteredInstitutions}
              onClose={() => setInstitutionOpen(false)}
              onQuery={setInstitutionQuery}
              onSelect={setInstitutionId}
              query={institutionQuery}
              selected={institutionId}
              visible={institutionOpen}
            />
          </> : reviewed ? <>
            <UiText accessibilityRole="header" variant="heading">{t('offlineAccount.reviewTitle')}</UiText>
            <View style={[styles.review, { borderColor: palette.border }]}>
              <ReviewRow label={t('offlineAccount.name')} value={reviewed.name} first />
              <ReviewRow label={t('offlineAccount.balance')} value={formatMoney(reviewed.currentBalance, { locale, currency: selectedCurrency?.code ?? null })} data />
              <ReviewRow label={t('offlineAccount.currency')} value={selectedCurrency ? `${selectedCurrency.code} · ${selectedCurrency.description}` : t('offlineAccount.unavailable')} />
              <ReviewRow label={t('offlineAccount.institution')} value={selectedInstitution?.displayName ?? (reviewed.financialInstitutionId ? t('offlineAccount.institutionUnnamed') : t('offlineAccount.none'))} />
            </View>
            <View style={styles.context}>
              <UiText variant="bodyStrong">{t('offlineAccount.manualTitle')}</UiText>
              <UiText tone="muted" variant="meta">{t('offlineAccount.manualContext')}</UiText>
              <UiText tone="muted" variant="meta">{t('offlineAccount.conversionContext')}</UiText>
            </View>
            {failure ? <FormNotice tone="destructive">{t(`offlineAccount.errors.${failure}`)}</FormNotice> : null}
            {phase === 'unknown' ? <>
              <View style={styles.context}>
                <UiText variant="bodyStrong">{t('offlineAccount.unknownTitle')}</UiText>
                <FormNotice tone="destructive">{t('offlineAccount.unknownMessage')}</FormNotice>
              </View>
              <View style={styles.actions}>
                <Button label={t('offlineAccount.checkAccounts')} onPress={onCheckAccounts} />
                <Button label={t('offlineAccount.createAnother')} onPress={createAnother} variant="secondary" />
              </View>
            </> : <View style={styles.actions}>
              <Button disabled={pending} label={t('offlineAccount.edit')} onPress={() => { setPhase('form'); setFailure(null) }} variant="secondary" />
            </View>}
          </> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function ReviewRow({ label, value, data = false, first = false }: { label: string; value: string; data?: boolean; first?: boolean }) {
  const palette = usePalette()
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={[styles.reviewRow, !first && { borderTopWidth: 1, borderTopColor: palette.border }]}>
      <UiText style={styles.reviewLabel} variant="body">{label}</UiText>
      <UiText style={styles.reviewValue} variant={data ? 'amountBase' : 'body'}>{value}</UiText>
    </View>
  )
}

/** Search narrows to this many before the form asks you to keep typing. */
const INSTITUTION_RESULT_LIMIT = 8

/** Web's institution combobox at phone width: a sheet with a search field and a radio list. */
function InstitutionSheet({ visible, institutions, query, selected, onQuery, onSelect, onClose }: {
  visible: boolean
  institutions: readonly (AccountFinancialInstitutionDto & { label: string })[]
  query: string
  selected: number | null
  onQuery: (value: string) => void
  onSelect: (value: number | null) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const palette = usePalette()
  const choose = (value: number | null) => { onSelect(value); onClose() }
  const options: { value: number | null; label: string }[] = [
    { value: null, label: t('offlineAccount.none') },
    ...institutions.slice(0, INSTITUTION_RESULT_LIMIT).map((item) => ({ value: item.accountFinancialInstitutionKey, label: item.label })),
  ]
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <Pressable accessibilityLabel={t('offlineAccount.institution')} onPress={onClose} style={[styles.backdrop, { backgroundColor: palette.scrim }]} />
      <SafeAreaView edges={['bottom']} style={[styles.sheet, { backgroundColor: palette.popover, borderColor: palette.border }, themeTokens.shadow.overlay]}>
        <UiText accessibilityRole="header" variant="section">{t('offlineAccount.institution')}</UiText>
        <TextInput
          accessibilityLabel={t('banking.connect.searchLabel')}
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={onQuery}
          placeholder={t('banking.connect.searchLabel')}
          placeholderTextColor={palette.mutedForeground}
          style={[styles.input, { color: palette.foreground, borderColor: palette.input }]}
          value={query}
        />
        <ScrollView accessibilityLabel={t('offlineAccount.institution')} accessibilityRole="radiogroup" keyboardShouldPersistTaps="handled" style={styles.sheetList}>
          {options.map((option, index) => {
            const checked = option.value === selected
            return (
              <Pressable
                accessibilityLabel={option.label}
                accessibilityRole="radio"
                accessibilityState={{ checked }}
                key={String(option.value)}
                onPress={() => choose(option.value)}
                style={({ pressed }) => [styles.option, index > 0 && { borderTopWidth: 1, borderTopColor: palette.border }, pressed && { backgroundColor: palette.muted }]}
              >
                <UiText numberOfLines={1} style={styles.optionText} tone={checked ? 'primary' : 'default'} variant={checked ? 'bodyStrong' : 'body'}>{option.label}</UiText>
                {checked ? <Icon color={palette.primary} name="check" size={16} /> : null}
              </Pressable>
            )
          })}
          {institutions.length === 0 ? <UiText style={styles.sheetNote} tone="muted" variant="meta">{t('banking.connect.noMatches')}</UiText> : null}
          {institutions.length > INSTITUTION_RESULT_LIMIT ? (
            <UiText style={styles.sheetNote} tone="muted" variant="meta">{t('offlineAccount.institutionMore', { count: institutions.length - INSTITUTION_RESULT_LIMIT })}</UiText>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[10] },
  page: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: themeTokens.spacing[4] },
  input: { ...textStyles.body, minHeight: themeTokens.size.control, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3] },
  backdrop: { flex: 1 },
  sheet: { maxHeight: '80%', borderTopWidth: 1, borderTopLeftRadius: themeTokens.radius.xl, borderTopRightRadius: themeTokens.radius.xl, paddingTop: themeTokens.spacing[4], paddingHorizontal: themeTokens.layout.screenPadding, gap: themeTokens.spacing[3] },
  sheetList: { flexGrow: 0 },
  sheetNote: { paddingVertical: themeTokens.spacing[3] },
  option: { minHeight: themeTokens.touchTarget.minimum + 8, flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[3], paddingVertical: themeTokens.spacing[3] },
  optionText: { flex: 1 },
  review: { borderWidth: 1, borderRadius: themeTokens.radius.xl },
  reviewRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[4], paddingHorizontal: themeTokens.spacing[4], paddingVertical: themeTokens.spacing[3] },
  reviewLabel: { flexShrink: 0 },
  reviewValue: { flexShrink: 1, textAlign: 'right' },
  context: { gap: themeTokens.spacing[2] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
})
