import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BackHandler, ScrollView, StyleSheet, View } from 'react-native'

import { AmountEntry } from '@/components/ui/amount-entry'
import { Button } from '@/components/ui/button'
import { DateField, formatIsoDate } from '@/components/ui/date-field'
import { FormBar } from '@/components/ui/form-bar'
import { FormGroup, FormTextRow } from '@/components/ui/form-row'
import { Notice } from '@/components/ui/notice'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Text } from '@/components/ui/text'
import { formatNumberInput } from '@/lib/formatters/decimal-input'
import { themeTokens } from '@/theme/tokens'
import { useFormatMoney } from '@/lib/formatters/money-display'
import { usePalette } from '@/theme/use-palette'

import { goalCreateWriteSchema, invalidGoalCreateFields, parseGoalTargetDate, parseLocalizedGoalMoney, type GoalCreateWrite } from './goals-contract'
import type { GoalCreateFailure } from './use-create-goal'


export type GoalCreateScreenProps = Readonly<{
  pending: boolean
  failure: GoalCreateFailure | null
  unknownPayload: Readonly<GoalCreateWrite> | null
  refreshingGoals: boolean
  goalsRefreshFailed: boolean
  confirmedGoalId: number | null
  detailState: 'idle' | 'loading' | 'unavailable'
  onBack: () => void
  onSubmit: (payload: GoalCreateWrite) => Promise<void>
  onRefreshGoals: () => Promise<void>
  onRetryDetails: () => Promise<void>
}>

/** The earliest target date the API accepts: goals are dated in the future. */
function tomorrow(): string {
  const now = new Date()
  return formatIsoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))
}

/**
 * Create goal, as a calm-structure flow: the form bar (close, save), the
 * target big and centred, then one group of rows. Save reviews first: the ✓
 * freezes the details, and the ✓ on the review creates the goal.
 */
export function GoalCreateScreen(props: GoalCreateScreenProps) {
  const formatMoney = useFormatMoney()
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const [name, setName] = useState(props.unknownPayload?.name ?? '')
  const [target, setTarget] = useState(props.unknownPayload ? formatNumberInput(props.unknownPayload.targetAmount, locale) : '')
  const [description, setDescription] = useState(props.unknownPayload?.description ?? '')
  const [monthly, setMonthly] = useState(props.unknownPayload?.monthlyContributionTarget ? formatNumberInput(props.unknownPayload.monthlyContributionTarget, locale) : '')
  const [targetDate, setTargetDate] = useState(props.unknownPayload?.targetDate?.slice(0, 10) ?? '')
  const [reviewed, setReviewed] = useState<Readonly<GoalCreateWrite> | null>(props.unknownPayload)
  const unknown = props.unknownPayload !== null
  const effectiveReviewed = props.unknownPayload ?? reviewed

  useEffect(() => {
    if (!props.pending) return
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true)
    return () => subscription.remove()
  }, [props.pending])

  const targetAmountValue = parseLocalizedGoalMoney(target, locale)
  const monthlyAmount = monthly.trim() ? parseLocalizedGoalMoney(monthly, locale) : undefined
  const targetDateValue = targetDate.trim() ? parseGoalTargetDate(targetDate) : undefined
  const candidate = {
    name,
    targetAmount: targetAmountValue,
    ...(description.length ? { description } : {}),
    ...(monthlyAmount === undefined ? {} : { monthlyContributionTarget: monthlyAmount }),
    ...(targetDateValue === undefined ? {} : { targetDate: targetDateValue }),
  }
  // Re-derived on every render so an error clears the moment it's fixed. A
  // field not filled yet only keeps the ✓ disabled; an error shows for what
  // was entered and is wrong.
  const invalid = invalidGoalCreateFields({ name, targetAmount: targetAmountValue, monthlyRaw: monthly, monthlyAmount, targetDateRaw: targetDate, targetDate: targetDateValue, candidate })
  const ready = invalid.size === 0
  const nameError = invalid.has('name') && name.length > 0 ? t('goalCreate.fieldErrors.name') : null
  const targetError = invalid.has('target') && target.trim() !== '' ? t('goalCreate.fieldErrors.target') : null
  const monthlyError = invalid.has('monthly') ? t('goalCreate.fieldErrors.monthly') : null
  const dateError = invalid.has('date') ? t('goalCreate.fieldErrors.date') : undefined

  const stageReview = () => {
    if (!ready) return
    const result = goalCreateWriteSchema.safeParse(candidate)
    if (!result.success) return
    setReviewed(Object.freeze(result.data))
  }

  const amount = (value: number) => formatMoney(value, { locale, currency: null, minimumFractionDigits: 0, maximumFractionDigits: 4 })
  const date = effectiveReviewed?.targetDate ? new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(effectiveReviewed.targetDate)) : null
  const confirming = effectiveReviewed !== null && !unknown && props.confirmedGoalId === null

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <FormBar
        closeDisabled={props.pending}
        closeLabel={t('common.close')}
        onClose={props.onBack}
        onSave={!effectiveReviewed ? stageReview : confirming ? () => void props.onSubmit(effectiveReviewed) : undefined}
        saveDisabled={!effectiveReviewed ? !ready : props.pending}
        saveLabel={!effectiveReviewed ? t('goalCreate.review') : props.pending ? t('goalCreate.creating') : t('goalCreate.confirm')}
        saving={confirming && props.pending}
        title={t('goalCreate.title')}
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.page}>
          {!effectiveReviewed ? (
            <View style={styles.form}>
              <AmountEntry
                accessibilityLabel={t('goalCreate.target')}
                caption={t('goalCreate.currencyTitle')}
                currency={null}
                error={targetError}
                locale={locale}
                onChangeText={setTarget}
                value={target}
              />
              <FormGroup>
                <FormTextRow key="name" autoCapitalize="sentences" error={nameError} label={t('goalCreate.name')} maxLength={100} onChangeText={setName} value={name} />
                <FormTextRow key="monthly" error={monthlyError} keyboardType="decimal-pad" label={t('goalCreate.monthly')} onChangeText={setMonthly} placeholder={t('goalCreate.optional')} value={monthly} />
                <DateField key="date" appearance="row" error={dateError} label={t('goalCreate.date')} minimumDate={tomorrow()} onChange={(value) => setTargetDate(value ?? '')} optional value={targetDate || null} />
                <FormTextRow key="description" label={t('goalCreate.description')} maxLength={500} multiline onChangeText={setDescription} placeholder={t('goalCreate.optional')} value={description} />
              </FormGroup>
              <Text tone="muted" variant="meta">{t('goalCreate.currencyHelper')}</Text>
            </View>
          ) : (
            <View style={styles.form}>
              <View style={styles.reviewHead}>
                <Text accessibilityRole="header" variant="heading">{t('goalCreate.reviewTitle')}</Text>
                <Text tone="muted" variant="meta">{t('goalCreate.reviewHelper')}</Text>
              </View>
              <View style={[styles.reviewList, { borderColor: palette.border }]}>
                <ReviewRow first label={t('goalCreate.name')} value={effectiveReviewed.name} />
                <ReviewRow data label={t('goalCreate.target')} value={amount(effectiveReviewed.targetAmount)} />
                <ReviewRow label={t('goalCreate.description')} value={effectiveReviewed.description || t('goalCreate.notSet')} />
                <ReviewRow data={Boolean(effectiveReviewed.monthlyContributionTarget)} label={t('goalCreate.monthly')} value={effectiveReviewed.monthlyContributionTarget ? amount(effectiveReviewed.monthlyContributionTarget) : t('goalCreate.notSet')} />
                <ReviewRow label={t('goalCreate.date')} value={date ?? t('goalCreate.notSet')} />
                <ReviewRow label={t('goalCreate.currency')} value={t('goalCreate.profileCurrency')} />
              </View>
              {props.failure && !unknown ? <Notice message={t(`goalCreate.failures.${props.failure}`)} tone="destructive" /> : null}
              {unknown ? (
                <View style={styles.state}>
                  <Notice message={t('goalCreate.unknownMessage')} title={t('goalCreate.unknownTitle')} tone="destructive" />
                  <Text tone="muted" variant="meta">{props.refreshingGoals ? t('goalCreate.reconciling') : props.goalsRefreshFailed ? t('goalCreate.refreshFailed') : t('goalCreate.reviewGoals')}</Text>
                  <Text tone="muted" variant="meta">{t('goalCreate.noInference')}</Text>
                  <View style={styles.actions}>
                    <Button label={t('goalCreate.returnGoals')} onPress={props.onBack} variant="secondary" />
                    <Button disabled={props.refreshingGoals} label={props.refreshingGoals ? t('goalCreate.refreshingGoals') : t('goalCreate.refreshGoals')} loading={props.refreshingGoals} onPress={() => void props.onRefreshGoals()} />
                  </View>
                </View>
              ) : props.confirmedGoalId !== null ? (
                <View style={styles.state}>
                  {props.detailState === 'unavailable'
                    ? <Notice message={t('goalCreate.detailUnavailableMessage', { id: props.confirmedGoalId })} title={t('goalCreate.detailUnavailableTitle')} />
                    : (
                      <View style={styles.reviewHead}>
                        <Text accessibilityRole="header" variant="bodyStrong">{t('goalCreate.detailLoading')}</Text>
                        <Text accessibilityRole="progressbar" tone="muted" variant="meta">{t('goalCreate.detailLoadingMessage', { id: props.confirmedGoalId })}</Text>
                      </View>
                    )}
                  {props.detailState === 'unavailable' ? (
                    <View style={styles.actions}>
                      <Button label={t('goalCreate.returnGoals')} onPress={props.onBack} variant="secondary" />
                      <Button label={t('goalCreate.retryDetails')} onPress={() => void props.onRetryDetails()} />
                    </View>
                  ) : null}
                </View>
              ) : (
                <View style={styles.actions}>
                  <Button disabled={props.pending} label={t('goalCreate.edit')} onPress={() => setReviewed(null)} variant="secondary" />
                </View>
              )}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function ReviewRow({ label, value, data = false, first = false }: { label: string; value: string; data?: boolean; first?: boolean }) {
  const palette = usePalette()
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={[styles.reviewRow, !first && { borderTopWidth: 1, borderTopColor: palette.border }]}>
      <Text style={styles.reviewLabel} variant="body">{label}</Text>
      <Text style={styles.reviewValue} variant={data ? 'amountBase' : 'body'}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[10] },
  page: { width: '100%', maxWidth: 720, alignSelf: 'center' },
  form: { gap: themeTokens.spacing[4] },
  reviewHead: { gap: themeTokens.spacing[2], paddingTop: themeTokens.spacing[4] },
  reviewList: { borderWidth: 1, borderRadius: themeTokens.radius.xl },
  reviewRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[4], paddingHorizontal: themeTokens.spacing[4], paddingVertical: themeTokens.spacing[3] },
  reviewLabel: { flexShrink: 0, maxWidth: '50%' },
  reviewValue: { flexShrink: 1, textAlign: 'right' },
  state: { gap: themeTokens.spacing[3] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
})
