import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BackControl } from '@/components/ui/back-control'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import { goalCreateWriteSchema, invalidGoalCreateFields, parseGoalTargetDate, parseLocalizedGoalMoney, type GoalCreateField, type GoalCreateWrite } from './goals-contract'
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

export function GoalCreateScreen(props: GoalCreateScreenProps) {
  const { t, i18n } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const [name, setName] = useState(props.unknownPayload?.name ?? '')
  const [target, setTarget] = useState(props.unknownPayload ? String(props.unknownPayload.targetAmount) : '')
  const [description, setDescription] = useState(props.unknownPayload?.description ?? '')
  const [monthly, setMonthly] = useState(props.unknownPayload?.monthlyContributionTarget ? String(props.unknownPayload.monthlyContributionTarget) : '')
  const [targetDate, setTargetDate] = useState(props.unknownPayload?.targetDate?.slice(0, 10) ?? '')
  const [reviewed, setReviewed] = useState<Readonly<GoalCreateWrite> | null>(props.unknownPayload)
  const [submitted, setSubmitted] = useState(false)
  const unknown = props.unknownPayload !== null
  const effectiveReviewed = props.unknownPayload ?? reviewed

  useEffect(() => {
    if (!props.pending) return
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true)
    return () => subscription.remove()
  }, [props.pending])

  const buildCandidate = () => {
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
    return { targetAmountValue, monthlyAmount, targetDateValue, candidate }
  }

  // Re-derived on every render (not stored) so a field's error clears the
  // moment it's fixed, not only on the next submit attempt.
  const { targetAmountValue, monthlyAmount, targetDateValue, candidate } = buildCandidate()
  const shown = submitted
    ? invalidGoalCreateFields({ name, targetAmount: targetAmountValue, monthlyRaw: monthly, monthlyAmount, targetDateRaw: targetDate, targetDate: targetDateValue, candidate })
    : new Set<GoalCreateField>()

  const stageReview = () => {
    setSubmitted(true)
    if (invalidGoalCreateFields({ name, targetAmount: targetAmountValue, monthlyRaw: monthly, monthlyAmount, targetDateRaw: targetDate, targetDate: targetDateValue, candidate }).size > 0) return
    const result = goalCreateWriteSchema.safeParse(candidate)
    if (!result.success) return
    setSubmitted(false)
    setReviewed(Object.freeze(result.data))
  }

  const amount = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(value)
  const date = effectiveReviewed?.targetDate ? new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(effectiveReviewed.targetDate)) : null

  return <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}><View style={styles.page}>
    <View style={styles.header}><BackControl fallback="/goals" label={t('goalCreate.back')} onPress={props.onBack} disabled={props.pending} /><View style={styles.heading}><Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>{t('goalCreate.title')}</Text><Text style={[styles.lead, { color: palette.mutedForeground }]}>{t('goalCreate.helper')}</Text></View></View>
    {!effectiveReviewed ? <View style={styles.form}>
      <Field label={t('goalCreate.name')} required count={`${name.length}/100`} errorText={shown.has('name') ? t('goalCreate.fieldErrors.name') : undefined} palette={palette}><TextInput accessibilityLabel={t('goalCreate.name')} autoCapitalize="sentences" maxLength={100} value={name} onChangeText={setName} style={[styles.input, { color: palette.foreground, borderColor: shown.has('name') ? palette.destructive : palette.border, backgroundColor: palette.card }, shown.has('name') && styles.inputInvalid]} /></Field>
      <Field label={t('goalCreate.target')} required hint={t('goalCreate.moneyHint')} errorText={shown.has('target') ? t('goalCreate.fieldErrors.target') : undefined} palette={palette}><TextInput accessibilityLabel={t('goalCreate.target')} keyboardType="decimal-pad" value={target} onChangeText={setTarget} placeholder="0.00" placeholderTextColor={palette.mutedForeground} style={[styles.input, styles.money, { color: palette.foreground, borderColor: shown.has('target') ? palette.destructive : palette.border, backgroundColor: palette.card }, shown.has('target') && styles.inputInvalid]} /></Field>
      <Field label={t('goalCreate.description')} count={`${description.length}/500`} palette={palette}><TextInput accessibilityLabel={t('goalCreate.description')} maxLength={500} multiline value={description} onChangeText={setDescription} style={[styles.input, styles.multiline, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.card }]} /></Field>
      <Field label={t('goalCreate.monthly')} hint={t('goalCreate.moneyHint')} errorText={shown.has('monthly') ? t('goalCreate.fieldErrors.monthly') : undefined} palette={palette}><TextInput accessibilityLabel={t('goalCreate.monthly')} keyboardType="decimal-pad" value={monthly} onChangeText={setMonthly} placeholder={t('goalCreate.optional')} placeholderTextColor={palette.mutedForeground} style={[styles.input, styles.money, { color: palette.foreground, borderColor: shown.has('monthly') ? palette.destructive : palette.border, backgroundColor: palette.card }, shown.has('monthly') && styles.inputInvalid]} /></Field>
      <Field label={t('goalCreate.date')} hint={t('goalCreate.dateHint')} errorText={shown.has('date') ? t('goalCreate.fieldErrors.date') : undefined} palette={palette}><TextInput accessibilityLabel={t('goalCreate.date')} autoCapitalize="none" keyboardType="numbers-and-punctuation" value={targetDate} onChangeText={setTargetDate} placeholder="YYYY-MM-DD" placeholderTextColor={palette.mutedForeground} style={[styles.input, styles.money, { color: palette.foreground, borderColor: shown.has('date') ? palette.destructive : palette.border, backgroundColor: palette.card }, shown.has('date') && styles.inputInvalid]} /></Field>
      <View style={[styles.currencyNote, { backgroundColor: palette.primarySoft }]}><Text style={[styles.noteTitle, { color: palette.foreground }]}>{t('goalCreate.currencyTitle')}</Text><Text style={[styles.helper, { color: palette.mutedForeground }]}>{t('goalCreate.currencyHelper')}</Text></View>
      <Action label={t('goalCreate.review')} onPress={stageReview} palette={palette} />
    </View> : <View style={styles.reviewSection}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.foreground }]}>{t('goalCreate.reviewTitle')}</Text>
      <Text style={[styles.helper, { color: palette.mutedForeground }]}>{t('goalCreate.reviewHelper')}</Text>
      <View style={[styles.reviewCard, { borderColor: palette.border, backgroundColor: palette.card }]}>
        <ReviewRow label={t('goalCreate.name')} value={effectiveReviewed.name} palette={palette} />
        <ReviewRow label={t('goalCreate.target')} value={amount(effectiveReviewed.targetAmount)} palette={palette} data />
        <ReviewRow label={t('goalCreate.description')} value={effectiveReviewed.description || t('goalCreate.notSet')} palette={palette} />
        <ReviewRow label={t('goalCreate.monthly')} value={effectiveReviewed.monthlyContributionTarget ? amount(effectiveReviewed.monthlyContributionTarget) : t('goalCreate.notSet')} palette={palette} data={Boolean(effectiveReviewed.monthlyContributionTarget)} />
        <ReviewRow label={t('goalCreate.date')} value={date ?? t('goalCreate.notSet')} palette={palette} />
        <ReviewRow label={t('goalCreate.currency')} value={t('goalCreate.profileCurrency')} palette={palette} />
      </View>
      {props.failure && !unknown ? <Text accessibilityRole="alert" style={[styles.alert, { color: palette.destructive }]}>{t(`goalCreate.failures.${props.failure}`)}</Text> : null}
      {unknown ? <View style={[styles.unknown, { borderColor: palette.destructive, backgroundColor: palette.muted }]}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.foreground }]}>{t('goalCreate.unknownTitle')}</Text>
        <Text accessibilityRole="alert" style={[styles.helper, { color: palette.mutedForeground }]}>{t('goalCreate.unknownMessage')}</Text>
        <Text style={[styles.helper, { color: palette.mutedForeground }]}>{props.refreshingGoals ? t('goalCreate.reconciling') : props.goalsRefreshFailed ? t('goalCreate.refreshFailed') : t('goalCreate.reviewGoals')}</Text>
        <Text style={[styles.helper, { color: palette.mutedForeground }]}>{t('goalCreate.noInference')}</Text>
        <View style={styles.actions}><Action label={t('goalCreate.returnGoals')} onPress={props.onBack} palette={palette} secondary /><Action label={props.refreshingGoals ? t('goalCreate.refreshingGoals') : t('goalCreate.refreshGoals')} onPress={props.onRefreshGoals} palette={palette} disabled={props.refreshingGoals} busy={props.refreshingGoals} /></View>
      </View> : props.confirmedGoalId !== null ? <View style={[styles.unknown, { borderColor: palette.border, backgroundColor: palette.muted }]}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.foreground }]}>{props.detailState === 'loading' ? t('goalCreate.detailLoading') : t('goalCreate.detailUnavailableTitle')}</Text>
        <Text accessibilityRole={props.detailState === 'unavailable' ? 'alert' : undefined} style={[styles.helper, { color: palette.mutedForeground }]}>{props.detailState === 'loading' ? t('goalCreate.detailLoadingMessage', { id: props.confirmedGoalId }) : t('goalCreate.detailUnavailableMessage', { id: props.confirmedGoalId })}</Text>
        {props.detailState === 'unavailable' ? <View style={styles.actions}><Action label={t('goalCreate.returnGoals')} onPress={props.onBack} palette={palette} secondary /><Action label={t('goalCreate.retryDetails')} onPress={props.onRetryDetails} palette={palette} /></View> : null}
      </View> : <View style={styles.actions}><Action label={t('goalCreate.edit')} onPress={() => setReviewed(null)} palette={palette} secondary disabled={props.pending} /><Action label={props.pending ? t('goalCreate.creating') : t('goalCreate.confirm')} onPress={() => props.onSubmit(effectiveReviewed)} palette={palette} disabled={props.pending} busy={props.pending} /></View>}
    </View>}
  </View></ScrollView></SafeAreaView>
}

function Field({ label, required = false, count, hint, errorText, palette, children }: { label: string; required?: boolean; count?: string; hint?: string; errorText?: string; palette: Palette; children: React.ReactNode }) {
  return <View style={styles.field}><View style={styles.labelRow}><Text style={[styles.label, { color: palette.foreground }]}>{label}{required ? ' *' : ''}</Text>{count ? <Text style={[styles.counter, { color: palette.mutedForeground }]}>{count}</Text> : null}</View>{children}{errorText ? <Text accessibilityRole="alert" style={[styles.helper, { color: palette.destructive }]}>{errorText}</Text> : hint ? <Text style={[styles.helper, { color: palette.mutedForeground }]}>{hint}</Text> : null}</View>
}
function ReviewRow({ label, value, data = false, palette }: { label: string; value: string; data?: boolean; palette: Palette }) { return <View accessible accessibilityLabel={`${label}: ${value}`} style={styles.reviewRow}><Text style={[styles.helper, { color: palette.mutedForeground }]}>{label}</Text><Text style={[data ? styles.dataValue : styles.value, { color: palette.foreground }]}>{value}</Text></View> }
function Action({ label, onPress, palette, secondary = false, disabled = false, busy = false }: { label: string; onPress: () => void | Promise<void>; palette: Palette; secondary?: boolean; disabled?: boolean; busy?: boolean }) { return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, busy }} disabled={disabled} onPress={() => void onPress()} style={({ pressed }) => [styles.button, { borderColor: palette.primary, backgroundColor: secondary ? 'transparent' : palette.primary }, (pressed || disabled) && styles.pressed]}><Text style={[styles.buttonText, { color: secondary ? palette.primary : palette.background }]}>{label}</Text></Pressable> }

const styles = StyleSheet.create({
  safe: { flex: 1 }, content: { flexGrow: 1, padding: themeTokens.layout.screenPadding }, page: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: themeTokens.layout.blockGap }, header: { flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap', gap: themeTokens.spacing[4] }, heading: { flex: 1, minWidth: 220, gap: themeTokens.spacing[1] }, title: { ...textStyles.title, fontWeight: '700' as const }, lead: { ...textStyles.body }, form: { gap: themeTokens.spacing[4] }, field: { gap: themeTokens.spacing[2] }, labelRow: { flexDirection: 'row', justifyContent: 'space-between', gap: themeTokens.spacing[3] }, label: { ...textStyles.bodyStrong, fontWeight: '600' as const }, counter: { ...textStyles.amountSmall }, input: { ...textStyles.body, minHeight: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3], paddingVertical: themeTokens.spacing[2] }, inputInvalid: { borderWidth: 2 }, multiline: { minHeight: 112, textAlignVertical: 'top' }, money: { fontFamily: themeTokens.typography.roles.data.fontFamily }, helper: { ...textStyles.body }, currencyNote: { borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[1] }, noteTitle: { ...textStyles.action }, alert: { ...textStyles.body }, reviewSection: { gap: themeTokens.spacing[4] }, sectionTitle: { ...textStyles.section }, reviewCard: { borderWidth: 1, borderRadius: themeTokens.radius.xl, padding: themeTokens.spacing[5], gap: themeTokens.spacing[4] }, reviewRow: { gap: themeTokens.spacing[1] }, value: { ...textStyles.body }, dataValue: { ...textStyles.amount }, actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: themeTokens.spacing[3] }, unknown: { borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[5], gap: themeTokens.spacing[3] }, candidate: { borderTopWidth: 1, paddingTop: themeTokens.spacing[3], gap: themeTokens.spacing[1] }, candidateName: { ...textStyles.action }, button: { minHeight: themeTokens.touchTarget.minimum, minWidth: themeTokens.touchTarget.minimum, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[4] }, buttonText: { ...textStyles.action }, pressed: { opacity: 0.68 },
})
