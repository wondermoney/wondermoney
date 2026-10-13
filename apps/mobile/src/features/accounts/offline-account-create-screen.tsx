import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BackControl } from '@/components/ui/back-control'
import { formatCurrency } from '@/lib/formatters/financial'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import {
  invalidOfflineAccountFields,
  offlineAccountPayloadSchema,
  parsePositiveDecimal,
  type AccountCurrencyDto,
  type AccountFinancialInstitutionDto,
  type OfflineAccountField,
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
  const { t, i18n } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const initial = unknownGuard?.payload
  const [name, setName] = useState(initial?.name ?? '')
  const [balance, setBalance] = useState(initial ? String(initial.currentBalance) : '')
  const [currencyId, setCurrencyId] = useState<number | null>(initial?.currencyId ?? null)
  const [institutionId, setInstitutionId] = useState<number | null>(initial?.financialInstitutionId ?? null)
  const [reviewed, setReviewed] = useState<OfflineAccountPayload | null>(initial ?? null)
  const [phase, setPhase] = useState<'form' | 'review' | 'unknown'>(initial ? 'unknown' : 'form')
  const [failure, setFailure] = useState<OfflineAccountCreateFailure | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [institutionQuery, setInstitutionQuery] = useState('')
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
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
  // moment it's fixed, not only on the next submit attempt.
  const shownInvalid = submitted ? invalidOfflineAccountFields(name, balance, currencyId, currencies) : new Set<OfflineAccountField>()
  // The institution list is a fixed, UI-constrained choice — not covered by
  // invalidOfflineAccountFields — so a stale reference (e.g. from a resumed
  // unknownGuard payload whose institution no longer exists) has nowhere
  // field-level to surface and falls back to the old generic message.
  const institutionExists = institutionId === null || institutions.some((item) => item.accountFinancialInstitutionKey === institutionId)
  const showInstitutionError = submitted && !institutionExists

  const stageReview = () => {
    setSubmitted(true)
    const amount = parsePositiveDecimal(balance)
    if (invalidOfflineAccountFields(name, balance, currencyId, currencies).size > 0 || !institutionExists) return
    const result = offlineAccountPayloadSchema.safeParse({
      name,
      currentBalance: amount,
      currencyId,
      ...(institutionId === null ? {} : { financialInstitutionId: institutionId }),
    })
    if (!result.success) return
    setSubmitted(false)
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
    setSubmitted(false)
    setPhase('form')
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.page}>
          <View style={styles.topline}>
            <BackControl fallback="/accounts" label={t('offlineAccount.back')} onPress={onBack} disabled={pending} />
            <Text accessibilityRole="header" allowFontScaling style={[styles.title, { color: palette.foreground }]}>{t('offlineAccount.title')}</Text>
          </View>
          <Text allowFontScaling style={[styles.lead, { color: palette.mutedForeground }]}>{t('offlineAccount.helper')}</Text>

          {phase === 'form' ? <>
            <FieldLabel text={t('offlineAccount.name')} required palette={palette} />
            <TextInput
              accessibilityLabel={t('offlineAccount.name')}
              autoCapitalize="sentences"
              maxLength={100}
              onChangeText={setName}
              placeholder={t('offlineAccount.namePlaceholder')}
              placeholderTextColor={palette.mutedForeground}
              style={[styles.input, { color: palette.foreground, borderColor: shownInvalid.has('name') ? palette.destructive : palette.border, backgroundColor: palette.card }, shownInvalid.has('name') && styles.inputInvalid]}
              value={name}
            />
            <Text style={[styles.counter, { color: palette.mutedForeground }]}>{name.length}/100</Text>
            {shownInvalid.has('name') ? <Text accessibilityRole="alert" style={[styles.error, { color: palette.destructive }]}>{t('offlineAccount.fieldErrors.name')}</Text> : null}

            <FieldLabel text={t('offlineAccount.currency')} required palette={palette} />
            <View accessibilityRole="radiogroup" accessibilityLabel={t('offlineAccount.currency')} style={styles.chips}>
              {currencies.map((currency) => <Choice
                key={currency.currencyKey}
                compact
                label={`${currency.code} · ${currency.description}`}
                visibleLabel={currency.code}
                selected={currencyId === currency.currencyKey}
                onPress={() => setCurrencyId(currency.currencyKey)}
                palette={palette}
              />)}
            </View>
            {shownInvalid.has('currency') ? <Text accessibilityRole="alert" style={[styles.error, { color: palette.destructive }]}>{t('offlineAccount.fieldErrors.currency')}</Text> : null}

            <FieldLabel text={t('offlineAccount.institution')} palette={palette} />
            <View accessibilityRole="radiogroup" accessibilityLabel={t('offlineAccount.institution')} style={styles.options}>
              <Choice label={t('offlineAccount.none')} selected={institutionId === null} onPress={() => setInstitutionId(null)} palette={palette} />
              <TextInput
                accessibilityLabel={t('banking.connect.searchLabel')}
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setInstitutionQuery}
                placeholder={t('banking.connect.searchLabel')}
                placeholderTextColor={palette.mutedForeground}
                style={[styles.input, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.card }]}
                value={institutionQuery}
              />
              {filteredInstitutions.length === 0 ? (
                <Text style={[styles.helper, { color: palette.mutedForeground }]}>{t('banking.connect.noMatches')}</Text>
              ) : (
                // A shared background-step container with per-row dividers,
                // not N individually-bordered rows — a wall of boxes here
                // was the worst No-Nesting violation in the app (RAD audit).
                <View style={[styles.institutionList, { backgroundColor: palette.muted }]}>
                  {filteredInstitutions.slice(0, INSTITUTION_RESULT_LIMIT).map((institution, index) => (
                    <View key={institution.accountFinancialInstitutionKey} style={index > 0 ? [styles.institutionRow, { borderTopColor: palette.border }] : undefined}>
                      <Choice
                        label={institution.label}
                        selected={institutionId === institution.accountFinancialInstitutionKey}
                        onPress={() => setInstitutionId(institution.accountFinancialInstitutionKey)}
                        palette={palette}
                        bordered={false}
                      />
                    </View>
                  ))}
                  {filteredInstitutions.length > INSTITUTION_RESULT_LIMIT ? (
                    <Text style={[styles.helper, styles.institutionRow, { color: palette.mutedForeground, borderTopColor: palette.border }]}>
                      {t('offlineAccount.institutionMore', { count: filteredInstitutions.length - INSTITUTION_RESULT_LIMIT })}
                    </Text>
                  ) : null}
                </View>
              )}
              {showInstitutionError ? <Text accessibilityRole="alert" style={[styles.error, { color: palette.destructive }]}>{t('offlineAccount.validation.fields')}</Text> : null}
            </View>

            <FieldLabel text={t('offlineAccount.balance')} required palette={palette} />
            <TextInput
              accessibilityLabel={t('offlineAccount.balance')}
              keyboardType="decimal-pad"
              onChangeText={setBalance}
              placeholder="0.00"
              placeholderTextColor={palette.mutedForeground}
              style={[styles.input, styles.amountInput, { color: palette.foreground, borderColor: shownInvalid.has('balance') ? palette.destructive : palette.border, backgroundColor: palette.card }, shownInvalid.has('balance') && styles.inputInvalid]}
              value={balance}
            />
            <Text allowFontScaling style={[styles.helper, { color: palette.mutedForeground }]}>{t('offlineAccount.balanceHelper')}</Text>
            {shownInvalid.has('balance') ? <Text accessibilityRole="alert" style={[styles.error, { color: palette.destructive }]}>{t('offlineAccount.fieldErrors.balance')}</Text> : null}
            <Button label={t('offlineAccount.review')} onPress={stageReview} palette={palette} />
          </> : reviewed ? <>
            <View style={[styles.review, { borderColor: palette.border, backgroundColor: palette.card }]}>
              <Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.foreground }]}>{t('offlineAccount.reviewTitle')}</Text>
              <ReviewRow label={t('offlineAccount.name')} value={reviewed.name} palette={palette} />
              <ReviewRow label={t('offlineAccount.balance')} value={selectedCurrency ? formatCurrency(reviewed.currentBalance, { locale, currency: selectedCurrency.code }) : String(reviewed.currentBalance)} data palette={palette} />
              <ReviewRow label={t('offlineAccount.currency')} value={selectedCurrency ? `${selectedCurrency.code} · ${selectedCurrency.description}` : t('offlineAccount.unavailable')} palette={palette} />
              <ReviewRow label={t('offlineAccount.institution')} value={selectedInstitution?.displayName ?? (reviewed.financialInstitutionId ? t('offlineAccount.institutionUnnamed') : t('offlineAccount.none'))} palette={palette} />
            </View>
            <View style={[styles.context, { borderColor: palette.border, backgroundColor: palette.muted }]}>
              <Text style={[styles.sectionTitle, { color: palette.foreground }]}>{t('offlineAccount.manualTitle')}</Text>
              <Text style={[styles.helper, { color: palette.mutedForeground }]}>{t('offlineAccount.manualContext')}</Text>
              <Text style={[styles.helper, { color: palette.mutedForeground }]}>{t('offlineAccount.conversionContext')}</Text>
            </View>
            {failure ? <Text accessibilityRole="alert" style={[styles.error, { color: palette.destructive }]}>{t(`offlineAccount.errors.${failure}`)}</Text> : null}
            {phase === 'unknown' ? <>
              <View style={[styles.unknown, { borderColor: palette.destructive }]}>
                <Text style={[styles.sectionTitle, { color: palette.foreground }]}>{t('offlineAccount.unknownTitle')}</Text>
                <Text accessibilityRole="alert" style={[styles.helper, { color: palette.mutedForeground }]}>{t('offlineAccount.unknownMessage')}</Text>
              </View>
              <Button label={t('offlineAccount.checkAccounts')} onPress={onCheckAccounts} palette={palette} />
              <Button label={t('offlineAccount.createAnother')} onPress={createAnother} palette={palette} secondary />
            </> : <View style={styles.actions}>
              <Button label={t('offlineAccount.edit')} onPress={() => { setPhase('form'); setFailure(null) }} palette={palette} secondary disabled={pending} />
              <Button label={pending ? t('offlineAccount.creating') : t('offlineAccount.confirm')} onPress={confirm} palette={palette} disabled={pending} busy={pending} />
            </View>}
          </> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function FieldLabel({ text, required = false, palette }: { text: string; required?: boolean; palette: Palette }) {
  return <Text style={[styles.label, { color: palette.foreground }]}>{text}{required ? ' *' : ''}</Text>
}

function ReviewRow({ label, value, data = false, palette }: { label: string; value: string; data?: boolean; palette: Palette }) {
  return <View accessible accessibilityLabel={`${label}: ${value}`} style={styles.reviewRow}><Text style={[styles.helper, { color: palette.mutedForeground }]}>{label}</Text><Text style={[data ? styles.dataValue : styles.value, { color: palette.foreground }]}>{value}</Text></View>
}

/** Search narrows to this many before the form asks you to keep typing. */
const INSTITUTION_RESULT_LIMIT = 8

function Choice({ label, visibleLabel, selected, onPress, palette, compact = false, bordered = true }: { label: string; visibleLabel?: string; selected: boolean; onPress: () => void; palette: Palette; compact?: boolean; bordered?: boolean }) {
  // Unselected chips carry no border of their own, whether or not `bordered`
  // is set — a dozen-plus currency chips each individually boxed read as a
  // wall of empty containers. Only the selected chip earns a border/fill.
  return <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [compact ? styles.chip : styles.choice, selected ? { borderColor: bordered ? palette.primary : 'transparent', backgroundColor: palette.primaryWash } : { borderWidth: 0, backgroundColor: bordered ? palette.muted : 'transparent' }, pressed && styles.pressed]}>{compact ? null : <View style={[styles.radio, { borderColor: selected ? palette.primary : palette.mutedForeground }]}>{selected ? <View style={[styles.radioDot, { backgroundColor: palette.primary }]} /> : null}</View>}<Text style={[styles.choiceText, { color: selected ? palette.primary : palette.foreground }]}>{visibleLabel ?? label}</Text></Pressable>
}

function Button({ label, onPress, palette, secondary = false, disabled = false, busy = false }: { label: string; onPress: () => void | Promise<void>; palette: Palette; secondary?: boolean; disabled?: boolean; busy?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, busy }} disabled={disabled} onPress={() => void onPress()} style={({ pressed }) => [styles.button, { borderColor: palette.primary, backgroundColor: secondary ? 'transparent' : palette.primary }, (pressed || disabled) && styles.pressed]}><Text allowFontScaling style={[styles.buttonText, { color: secondary ? palette.primary : palette.background }]}>{label}</Text></Pressable>
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 }, content: { flexGrow: 1, padding: themeTokens.layout.screenPadding }, page: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: themeTokens.spacing[3] },
  topline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: themeTokens.spacing[4] }, title: { ...textStyles.title, fontWeight: '700' as const, flex: 1, minWidth: 220 },
  lead: { ...textStyles.body, marginBottom: themeTokens.spacing[3] }, label: { ...textStyles.bodyStrong, fontWeight: '600' as const, marginTop: themeTokens.spacing[2] },
  input: { ...textStyles.body, minHeight: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3] }, inputInvalid: { borderWidth: 2 }, amountInput: { fontFamily: themeTokens.typography.roles.data.fontFamily, textAlign: 'right' }, counter: { ...textStyles.amountSmall, alignSelf: 'flex-end' },
  options: { gap: themeTokens.spacing[2] }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] }, institutionList: { borderRadius: themeTokens.radius.md, overflow: 'hidden' }, institutionRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: themeTokens.spacing[3], paddingVertical: themeTokens.spacing[2] }, chip: { minHeight: 34, justifyContent: 'center', borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3] }, choice: { minHeight: themeTokens.touchTarget.minimum, flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[3], borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3], paddingVertical: themeTokens.spacing[2] }, choiceText: { ...textStyles.body, flex: 1 }, radio: { width: 20, height: 20, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, radioDot: { width: 10, height: 10, borderRadius: 5 },
  helper: { ...textStyles.body }, error: { ...textStyles.body },
  review: { borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[5], gap: themeTokens.spacing[3] }, sectionTitle: { ...textStyles.section }, reviewRow: { gap: themeTokens.spacing[1] }, value: { ...textStyles.body }, dataValue: { ...textStyles.amount },
  context: { borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[2] }, unknown: { borderLeftWidth: 3, paddingLeft: themeTokens.spacing[4], gap: themeTokens.spacing[2] }, actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: themeTokens.spacing[3] },
  button: { minHeight: themeTokens.touchTarget.minimum, minWidth: themeTokens.touchTarget.minimum, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[4] }, buttonText: { ...textStyles.action }, pressed: { opacity: 0.68 },
})
