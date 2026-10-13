import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, Text, TextInput, useColorScheme, View } from 'react-native'

import { formatCurrency } from '@/lib/formatters/financial'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import { createRepaymentAllocation, freezeRepaymentWrite, type FrozenRepaymentWrite, type RepaymentAllocationInputs } from './loan-repayment-allocation'
import type { LoanRepaymentCandidateDto } from './loans-contract'
import type { LoanRepaymentViewModel, LoanViewModel } from './loans-view-model'
import type { RepaymentWriteFailure } from './use-loan-repayment-mutation'

export type CandidateState =
  | { status: 'loading' | 'error' | 'invalid-response' }
  | { status: 'loaded' | 'refresh-error'; candidates: readonly LoanRepaymentCandidateDto[] }

type Props = Readonly<{
  loan: LoanViewModel
  candidates: CandidateState
  repayments: readonly LoanRepaymentViewModel[]
  pending: boolean
  refreshRequired: boolean
  onWrite: (write: FrozenRepaymentWrite) => Promise<RepaymentWriteFailure | 'success'>
  onRefreshCandidates: () => Promise<void> | void
  onResolveUnknown: () => Promise<boolean>
}>

type Editor =
  | { type: 'link'; candidate: LoanRepaymentCandidateDto; inputs: RepaymentAllocationInputs }
  | { type: 'edit'; repayment: LoanRepaymentViewModel; inputs: RepaymentAllocationInputs }

const inputStrings = (principal: number, interest: number, fee: number, total: number): RepaymentAllocationInputs => ({
  principal: String(principal), interest: String(interest), fee: String(fee), total: String(total),
})

export function LoanRepaymentWorkflow({ loan, candidates, repayments, pending, refreshRequired, onWrite, onRefreshCandidates, onResolveUnknown }: Props) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const [editor, setEditor] = useState<Editor | null>(null)
  const [reviewed, setReviewed] = useState<FrozenRepaymentWrite | null>(null)
  const [unlink, setUnlink] = useState<LoanRepaymentViewModel | null>(null)
  const [failure, setFailure] = useState<RepaymentWriteFailure | null>(null)
  const [failureAction, setFailureAction] = useState<FrozenRepaymentWrite['type'] | null>(null)
  const [validation, setValidation] = useState(false)
  const locked = pending || refreshRequired

  const updateInput = (key: keyof RepaymentAllocationInputs, value: string) => {
    setEditor((current) => current ? { ...current, inputs: { ...current.inputs, [key]: value } } : current)
  }
  const prepareReview = () => {
    if (!editor) return
    setValidation(false)
    try {
      if (editor.type === 'link') {
        const allocation = createRepaymentAllocation(editor.inputs, locale, { maximumPrincipal: editor.candidate.outstandingPrincipal, transactionAmount: editor.candidate.amount })
        setReviewed(freezeRepaymentWrite({ type: 'link', loanId: loan.id, transactionKey: editor.candidate.transaction.transactionKey, allocation }))
      } else {
        const transactionAmount = editor.repayment.transaction.settlementAmount === null ? null : Math.abs(editor.repayment.transaction.settlementAmount)
        const allocation = createRepaymentAllocation(editor.inputs, locale, { maximumPrincipal: loan.outstanding + editor.repayment.principal, transactionAmount })
        setReviewed(freezeRepaymentWrite({ type: 'edit', loanId: loan.id, repaymentLinkId: editor.repayment.id, allocation }))
      }
    } catch {
      setValidation(true)
    }
  }
  const execute = async (write: FrozenRepaymentWrite) => {
    setFailure(null)
    setFailureAction(write.type)
    const result = await onWrite(write)
    if (result === 'success') {
      setEditor(null); setReviewed(null); setUnlink(null)
    } else setFailure(result)
  }
  const money = (value: number) => formatCurrency(value, { locale, currency: loan.currencyCode })
  const loadedCandidates = 'candidates' in candidates ? candidates.candidates : []
  const resolveUnknown = async () => {
    const resolved = await onResolveUnknown()
    if (resolved) {
      setEditor(null); setReviewed(null); setUnlink(null); setFailure(null); setFailureAction(null)
    }
  }

  if (refreshRequired) {
    return <View style={[styles.gate, { borderColor: palette.destructive, backgroundColor: palette.muted }]}><Text accessibilityRole="header" style={[styles.heading, { color: palette.foreground }]}>{t('loanRepayment.unknownTitle')}</Text><Text accessibilityRole="alert" style={[styles.body, { color: palette.foreground }]}>{t('loanRepayment.unknownMessage')}</Text>{reviewed ? <AllocationSummary write={reviewed} money={money} palette={palette} /> : null}<Action label={t('loanRepayment.refreshBoth')} onPress={resolveUnknown} palette={palette} primary /></View>
  }

  return <View style={styles.section}>
    <View style={styles.titleBlock}><Text accessibilityRole="header" style={[styles.heading, { color: palette.foreground }]}>{t('loanRepayment.title')}</Text><Text style={[styles.body, { color: palette.mutedForeground }]}>{t('loanRepayment.classificationOnly')}</Text></View>
    {failure ? <Text accessibilityRole="alert" style={[styles.alert, { color: palette.foreground, borderColor: palette.border }]}>{t(failure === 'not-found' && failureAction === 'link' ? 'loanRepayment.result.staleCandidate' : `loanRepayment.result.${failure}`)}</Text> : null}

    {reviewed ? <View style={[styles.review, { borderColor: palette.border, backgroundColor: palette.muted }]}><Text accessibilityRole="header" style={[styles.subheading, { color: palette.foreground }]}>{t(reviewed.type === 'link' ? 'loanRepayment.reviewLink' : 'loanRepayment.reviewEdit')}</Text><Text style={[styles.body, { color: palette.mutedForeground }]}>{t('loanRepayment.reviewHelper')}</Text><AllocationSummary write={reviewed} money={money} palette={palette} /><View style={styles.actions}><Action label={t('common.cancel')} onPress={() => setReviewed(null)} palette={palette} disabled={pending} /><Action label={pending ? t('loanRepayment.saving') : t('loanRepayment.confirm')} onPress={() => execute(reviewed)} palette={palette} primary disabled={pending || failure === 'demo' || failure === 'access' || failure === 'mfa' || failure === 'not-found' || failure === 'conflict'} busy={pending} /></View></View> : null}

    {unlink ? <View style={[styles.review, { borderColor: palette.destructive }]}><Text accessibilityRole="header" style={[styles.subheading, { color: palette.foreground }]}>{t('loanRepayment.unlinkTitle')}</Text><Text style={[styles.body, { color: palette.foreground }]}>{t('loanRepayment.unlinkMessage', { amount: money(unlink.total) })}</Text><View style={styles.actions}><Action label={t('loanRepayment.keepLinked')} onPress={() => setUnlink(null)} palette={palette} disabled={pending} /><Action label={pending ? t('loanRepayment.unlinking') : t('loanRepayment.confirmUnlink')} onPress={() => execute(freezeRepaymentWrite({ type: 'unlink', loanId: loan.id, repaymentLinkId: unlink.id }))} palette={palette} primary disabled={pending} busy={pending} /></View></View> : null}

    {editor && !reviewed ? <View style={[styles.editor, { borderColor: palette.border }]}><Text accessibilityRole="header" style={[styles.subheading, { color: palette.foreground }]}>{t(editor.type === 'link' ? 'loanRepayment.allocateLink' : 'loanRepayment.allocateEdit')}</Text><Text style={[styles.body, { color: palette.mutedForeground }]}>{t('loanRepayment.readOnlyClassification')}</Text>{editor.type === 'link' && editor.candidate.suggestedAllocation.needsReview ? <Text style={[styles.alert, { color: palette.foreground, borderColor: palette.border }]}>{t('loanRepayment.suggestionNeedsReview')}</Text> : null}{editor.type === 'edit' && editor.repayment.notes ? <Text style={[styles.body, { color: palette.mutedForeground }]}>{t('loanRepayment.serverNotes', { notes: editor.repayment.notes })}</Text> : null}{editor.type === 'edit' && editor.repayment.needsReview ? <Text style={[styles.alert, { color: palette.foreground, borderColor: palette.border }]}>{t('loanRepayment.serverNeedsReview')}</Text> : null}<AmountField label={t('loanDetail.principal')} value={editor.inputs.principal} onChange={(value) => updateInput('principal', value)} palette={palette} /><AmountField label={t('loanDetail.interest')} value={editor.inputs.interest} onChange={(value) => updateInput('interest', value)} palette={palette} /><AmountField label={t('loanDetail.fee')} value={editor.inputs.fee} onChange={(value) => updateInput('fee', value)} palette={palette} /><AmountField label={t('loanRepayment.total')} value={editor.inputs.total} onChange={(value) => updateInput('total', value)} palette={palette} />{validation ? <Text accessibilityRole="alert" style={[styles.alert, { color: palette.destructive, borderColor: palette.destructive }]}>{t('loanRepayment.validation')}</Text> : null}<View style={styles.actions}><Action label={t('common.cancel')} onPress={() => setEditor(null)} palette={palette} /><Action label={t('loanRepayment.review')} onPress={prepareReview} palette={palette} primary /></View></View> : null}

    {!editor && !reviewed && !unlink ? <>
      <View style={styles.titleBlock}><Text accessibilityRole="header" style={[styles.subheading, { color: palette.foreground }]}>{t('loanRepayment.candidates')}</Text><Text style={[styles.body, { color: palette.mutedForeground }]}>{t('loanRepayment.candidatesHelper')}</Text></View>
      {candidates.status === 'loading' ? <Text accessibilityRole="progressbar" style={[styles.state, { color: palette.mutedForeground, borderColor: palette.border }]}>{t('loanRepayment.candidatesLoading')}</Text> : candidates.status === 'error' || candidates.status === 'invalid-response' ? <Text accessibilityRole="alert" style={[styles.state, { color: palette.foreground, borderColor: palette.border }]}>{t(candidates.status === 'invalid-response' ? 'loanRepayment.candidatesInvalid' : 'loanRepayment.candidatesError')}</Text> : <>{candidates.status === 'refresh-error' ? <Text accessibilityRole="alert" style={[styles.alert, { color: palette.foreground, borderColor: palette.border }]}>{t('loanRepayment.candidatesStale')}</Text> : null}{loadedCandidates.length === 0 ? <View style={[styles.state, { borderColor: palette.border, backgroundColor: palette.muted }]}><Text accessibilityRole="header" style={[styles.subheading, { color: palette.foreground }]}>{t('loanRepayment.candidatesEmptyTitle')}</Text><Text style={[styles.small, { color: palette.mutedForeground }]}>{t('loanRepayment.candidatesEmpty')}</Text></View> : loadedCandidates.map((candidate) => <CandidateCard key={candidate.transaction.transactionKey} candidate={candidate} money={money} locale={locale} palette={palette} disabled={locked} onSelect={() => { setFailure(null); setEditor({ type: 'link', candidate, inputs: inputStrings(candidate.suggestedAllocation.principalAmount, candidate.suggestedAllocation.interestAmount, candidate.suggestedAllocation.feeAmount, candidate.suggestedAllocation.totalPaymentAmount) }) }} />)}</>}
      {repayments.length > 0 ? <View style={styles.section}><Text accessibilityRole="header" style={[styles.subheading, { color: palette.foreground }]}>{t('loanRepayment.manageLinked')}</Text>{repayments.map((repayment) => <View key={repayment.id} style={[styles.manageRow, { borderColor: palette.border }]}><View style={styles.grow}><Text style={[styles.data, { color: palette.foreground }]}>{money(repayment.total)}</Text><Text style={[styles.small, { color: palette.mutedForeground }]}>{repayment.transaction.merchantName ?? repayment.transaction.description ?? t('transactions.unnamed')}</Text></View><Action label={t('loanRepayment.edit')} onPress={() => { setFailure(null); setEditor({ type: 'edit', repayment, inputs: inputStrings(repayment.principal, repayment.interest, repayment.fee, repayment.total) }) }} palette={palette} disabled={locked} /><Action label={t('loanRepayment.unlink')} onPress={() => { setFailure(null); setUnlink(repayment) }} palette={palette} disabled={locked} /></View>)}</View> : null}
    </> : null}
  </View>
}

function CandidateCard({ candidate, money, locale, palette, disabled, onSelect }: { candidate: LoanRepaymentCandidateDto; money: (value: number) => string; locale: string; palette: Palette; disabled: boolean; onSelect: () => void }) {
  const { t } = useTranslation()
  const label = candidate.transaction.merchantName ?? candidate.transaction.description ?? t('transactions.unnamed')
  const date = candidate.transaction.transactionDate ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(candidate.transaction.transactionDate)) : t('transactions.unavailable')
  const transactionAmount = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(candidate.amount)
  return <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.card }]}><View style={styles.grow}><Text style={[styles.subheading, { color: palette.foreground }]}>{label}</Text><Text style={[styles.small, { color: palette.mutedForeground }]}>{date} · {t(`loanRepayment.confidence.${candidate.confidence}`)}</Text><Text style={[styles.data, { color: palette.foreground }]}>{t('loanRepayment.transactionAmountUnknownCurrency', { amount: transactionAmount })}</Text><Text style={[styles.small, { color: palette.mutedForeground }]}>{t('loanRepayment.outstandingContext', { amount: money(candidate.outstandingPrincipal) })}</Text></View><Action label={t('loanRepayment.reviewCandidate')} onPress={onSelect} palette={palette} disabled={disabled} /></View>
}

function AllocationSummary({ write, money, palette }: { write: FrozenRepaymentWrite; money: (value: number) => string; palette: Palette }) {
  const { t } = useTranslation()
  if (write.type === 'unlink') return null
  return <View style={styles.summary}><Summary label={t('loanDetail.principal')} value={money(write.allocation.principalAmount)} palette={palette} /><Summary label={t('loanDetail.interest')} value={money(write.allocation.interestAmount)} palette={palette} /><Summary label={t('loanDetail.fee')} value={money(write.allocation.feeAmount)} palette={palette} /><Summary label={t('loanRepayment.total')} value={money(write.allocation.totalPaymentAmount)} palette={palette} /></View>
}
function Summary({ label, value, palette }: { label: string; value: string; palette: Palette }) { return <View style={styles.grow}><Text style={[styles.small, { color: palette.mutedForeground }]}>{label}</Text><Text style={[styles.data, { color: palette.foreground }]}>{value}</Text></View> }
function AmountField({ label, value, onChange, palette }: { label: string; value: string; onChange: (value: string) => void; palette: Palette }) { return <View style={styles.field}><Text style={[styles.small, { color: palette.foreground }]}>{label}</Text><TextInput accessibilityLabel={label} keyboardType="decimal-pad" value={value} onChangeText={onChange} style={[styles.input, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.card }]} /></View> }
function Action({ label, onPress, palette, primary = false, disabled = false, busy = false }: { label: string; onPress: () => void | Promise<unknown>; palette: Palette; primary?: boolean; disabled?: boolean; busy?: boolean }) { return <Pressable accessibilityRole="button" accessibilityState={{ disabled, busy }} disabled={disabled} onPress={() => void onPress()} style={({ pressed }) => [styles.button, { borderColor: primary ? 'transparent' : palette.input, backgroundColor: primary ? palette.primary : 'transparent' }, (pressed || disabled) && styles.disabled]}><Text style={[styles.buttonText, { color: primary ? palette.primaryForeground : palette.foreground }]}>{label}</Text></Pressable> }

const styles = StyleSheet.create({
  section: { gap: themeTokens.spacing[4] }, titleBlock: { gap: themeTokens.spacing[1] }, heading: { ...textStyles.section }, subheading: { ...textStyles.action }, body: { ...textStyles.body }, small: { ...textStyles.label }, data: { ...textStyles.amount }, card: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[3], borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4] }, grow: { flex: 1, gap: themeTokens.spacing[1] }, state: { ...textStyles.body, borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4] }, alert: { ...textStyles.body, borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[3] }, editor: { borderWidth: 1, borderRadius: themeTokens.radius.xl, padding: themeTokens.spacing[4], gap: themeTokens.spacing[4] }, review: { borderWidth: 2, borderRadius: themeTokens.radius.xl, padding: themeTokens.spacing[4], gap: themeTokens.spacing[4] }, gate: { borderWidth: 2, borderRadius: themeTokens.radius.xl, padding: themeTokens.spacing[5], gap: themeTokens.spacing[4] }, field: { gap: themeTokens.spacing[1] }, input: { ...textStyles.amount, minHeight: 48, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[3] }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] }, summary: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[3] }, manageRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: themeTokens.spacing[2], borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[3] }, button: { minHeight: 48, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[4] }, buttonText: { ...textStyles.bodyStrong, fontWeight: '600' as const }, disabled: { opacity: 0.55 },
})
