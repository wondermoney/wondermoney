import { RefreshControl, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/formatters/financial'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import type { LoanRepaymentViewModel, LoanViewModel } from './loans-view-model'
import { Alert, Failure, formatDate, Header, Loading } from './loans-screen'
import { LoanRepaymentWorkflow, type CandidateState } from './loan-repayment-workflow'
import type { FrozenRepaymentWrite } from './loan-repayment-allocation'
import type { RepaymentWriteFailure } from './use-loan-repayment-mutation'

type HistoryState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'invalid-response' }
  | { status: 'loaded'; repayments: readonly LoanRepaymentViewModel[] }
  | { status: 'refresh-error'; repayments: readonly LoanRepaymentViewModel[] }

export type LoanDetailViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'invalid-response' }
  | { status: 'not-found' }
  | { status: 'invalid-id' }
  | { status: 'access-transition' }
  | { status: 'loaded'; loan: LoanViewModel; history: HistoryState; refreshing?: boolean }
  | { status: 'refresh-error'; loan: LoanViewModel; history: HistoryState; refreshing?: boolean }


export function LoanDetailScreen({ state, onBack, onEdit = () => {}, onRefresh, repaymentWorkflow }: { state: LoanDetailViewState; onBack: () => void; onEdit?: () => void; onRefresh: () => void | Promise<void>; repaymentWorkflow?: { candidates: CandidateState; pending: boolean; refreshRequired: boolean; onWrite: (write: FrozenRepaymentWrite) => Promise<RepaymentWriteFailure | 'success'>; onRefreshCandidates: () => void | Promise<void>; onResolveUnknown: () => Promise<boolean> } }) {
  const { t, i18n } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  if (state.status === 'access-transition') return null
  if (state.status === 'loading') return <Loading label={t('loanDetail.loading')} palette={palette} />
  if (state.status === 'error' || state.status === 'invalid-response' || state.status === 'not-found' || state.status === 'invalid-id') {
    const key = state.status === 'invalid-response' ? 'invalid' : state.status === 'not-found' ? 'notFound' : state.status === 'invalid-id' ? 'invalidId' : 'error'
    return <Failure title={t(`loanDetail.${key}Title`)} message={t(`loanDetail.${key}Message`)} onRetry={state.status === 'invalid-id' ? undefined : onRefresh} onBack={onBack} backLabel={t('loanDetail.back')} palette={palette} />
  }
  const { loan } = state
  const money = (value: number) => formatCurrency(value, { locale, currency: loan.currencyCode })
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(loan.progressPercentage / 100)
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={Boolean(state.refreshing)} onRefresh={() => void onRefresh()} tintColor={palette.primary} />}>
        <View style={styles.page}>
          <Header title={loan.name} helper={`${t(`loans.type.${loan.type}`)} · ${t(`loans.status.${loan.status}`)}`} backLabel={t('loanDetail.back')} onBack={onBack} palette={palette} />
          {state.status === 'refresh-error' ? <Alert label={t('loanDetail.stale')} palette={palette} /> : null}
          <Button accessibilityLabel={t('loanDetail.edit')} label={t('loanDetail.edit')} onPress={onEdit} palette={palette} style={styles.editButton} variant="secondary" />
          <View style={styles.hero}>
            <Text allowFontScaling style={[styles.kicker, { color: palette.mutedForeground }]}>{t('loans.outstanding')}</Text>
            <Text
              accessibilityLabel={`${t('loans.outstanding')}, ${money(loan.outstanding)}, ${loan.currencyCode}`}
              accessible
              allowFontScaling
              style={[styles.heroAmount, { color: palette.foreground }]}
            >
              {money(loan.outstanding)}
            </Text>
            <View style={[styles.track, { backgroundColor: palette.muted }]}><View testID="loan-progress" style={[styles.fill, { width: `${loan.meterPercentage}%`, backgroundColor: palette.chart1 }]} /></View>
            <Text allowFontScaling style={[styles.progressText, { color: palette.mutedForeground }]}>{t('loanDetail.progressValue', { value: percent, basis: t(`loanDetail.progressBasis.${loan.progressBasis}`) })}</Text>
          </View>
          <View style={styles.grid}>
            <Metric label={t('loanDetail.openingBalance')} value={money(loan.openingBalance)} palette={palette} />
            {loan.originalPrincipal !== null ? <Metric label={t('loanDetail.originalPrincipal')} value={money(loan.originalPrincipal)} palette={palette} /> : null}
            {loan.regularPayment !== null ? <Metric label={t('loanDetail.regularPayment')} value={money(loan.regularPayment)} helper={t(`loans.frequency.${loan.paymentFrequency}`)} palette={palette} /> : null}
            {loan.annualRatePercent !== null ? <Metric label={t('loanDetail.interestRate')} value={new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(loan.annualRatePercent / 100)} helper={t(`loanDetail.rateType.${loan.rateType}`)} palette={palette} /> : null}
            {loan.termMonths !== null ? <Metric label={t('loanDetail.term')} value={t('loanDetail.monthCount', { count: loan.termMonths })} palette={palette} /> : null}
            {loan.remainingTermMonths !== null ? <Metric label={t('loanDetail.remainingTerm')} value={t('loanDetail.monthCount', { count: loan.remainingTermMonths })} palette={palette} /> : null}
          </View>
          <View style={[styles.context, { borderColor: palette.border, backgroundColor: palette.muted }]}>
            <Text accessibilityRole="header" allowFontScaling style={[styles.sectionTitle, { color: palette.foreground }]}>{t('loanDetail.loanDetails')}</Text>
            <DetailRow label={t('loanDetail.openingDate')} value={formatDate(loan.openingBalanceDate, locale)} palette={palette} />
            {loan.nextPaymentDate ? <DetailRow label={t('loanDetail.nextPayment')} value={formatDate(loan.nextPaymentDate, locale)} palette={palette} /> : null}
            {loan.paymentDay ? <DetailRow label={t('loanDetail.paymentDay')} value={String(loan.paymentDay)} palette={palette} /> : null}
            {loan.maturityDate ? <DetailRow label={t('loanDetail.maturity')} value={formatDate(loan.maturityDate, locale)} palette={palette} /> : null}
            {loan.providerName ? <DetailRow label={t('loanDetail.provider')} value={loan.providerName} palette={palette} /> : null}
            {loan.notes ? <DetailRow label={t('loanDetail.notes')} value={loan.notes} palette={palette} /> : null}
          </View>
          <RepaymentHistory state={state.history} currency={loan.currencyCode} locale={locale} palette={palette} />
          {repaymentWorkflow ? <LoanRepaymentWorkflow loan={loan} candidates={repaymentWorkflow.candidates} repayments={'repayments' in state.history ? state.history.repayments : []} pending={repaymentWorkflow.pending} refreshRequired={repaymentWorkflow.refreshRequired} onWrite={repaymentWorkflow.onWrite} onRefreshCandidates={repaymentWorkflow.onRefreshCandidates} onResolveUnknown={repaymentWorkflow.onResolveUnknown} /> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function Metric({ label, value, helper, palette }: { label: string; value: string; helper?: string; palette: Palette }) {
  return <View accessible accessibilityLabel={[label, value, helper].filter(Boolean).join(', ')} style={[styles.metric, { borderColor: palette.border, backgroundColor: palette.card }]}><Text allowFontScaling style={[styles.kicker, { color: palette.mutedForeground }]}>{label}</Text><Text allowFontScaling style={[styles.metricValue, { color: palette.foreground }]}>{value}</Text>{helper ? <Text allowFontScaling style={[styles.small, { color: palette.mutedForeground }]}>{helper}</Text> : null}</View>
}

function DetailRow({ label, value, palette }: { label: string; value: string; palette: Palette }) {
  return <View accessible accessibilityLabel={`${label}, ${value}`} style={[styles.detailRow, { borderTopColor: palette.border }]}><Text allowFontScaling style={[styles.detailLabel, { color: palette.mutedForeground }]}>{label}</Text><Text allowFontScaling style={[styles.detailValue, { color: palette.foreground }]}>{value}</Text></View>
}

function RepaymentHistory({ state, currency, locale, palette }: { state: HistoryState; currency: string; locale: string; palette: Palette }) {
  const { t } = useTranslation()
  return <View style={styles.history}><View style={styles.sectionHeading}><Text accessibilityRole="header" allowFontScaling style={[styles.sectionTitle, { color: palette.foreground }]}>{t('loanDetail.repayments')}</Text><Text allowFontScaling style={[styles.small, { color: palette.mutedForeground }]}>{t('loanDetail.repaymentsHelper')}</Text></View>{state.status === 'loading' ? <Text accessible accessibilityRole="progressbar" accessibilityLabel={t('loanDetail.repaymentsLoading')} allowFontScaling style={[styles.historyState, { color: palette.mutedForeground, borderColor: palette.border }]}>{t('loanDetail.repaymentsLoading')}</Text> : state.status === 'error' || state.status === 'invalid-response' ? <Text accessible accessibilityRole="alert" accessibilityLabel={t(state.status === 'invalid-response' ? 'loanDetail.repaymentsInvalid' : 'loanDetail.repaymentsError')} allowFontScaling style={[styles.historyState, { color: palette.foreground, borderColor: palette.border }]}>{t(state.status === 'invalid-response' ? 'loanDetail.repaymentsInvalid' : 'loanDetail.repaymentsError')}</Text> : <>{state.status === 'refresh-error' ? <Alert label={t('loanDetail.repaymentsStale')} palette={palette} /> : null}{state.repayments.length === 0 ? <View style={[styles.historyState, { borderColor: palette.border, backgroundColor: palette.muted }]}><Text accessibilityRole="header" allowFontScaling style={[styles.sectionTitle, { color: palette.foreground }]}>{t('loanDetail.repaymentsEmptyTitle')}</Text><Text allowFontScaling style={[styles.small, { color: palette.mutedForeground }]}>{t('loanDetail.repaymentsEmptyMessage')}</Text></View> : <View style={styles.repaymentList}>{state.repayments.map((repayment) => <RepaymentCard key={repayment.id} repayment={repayment} currency={currency} locale={locale} palette={palette} />)}</View>}</>}</View>
}

function RepaymentCard({ repayment, currency, locale, palette }: { repayment: LoanRepaymentViewModel; currency: string; locale: string; palette: Palette }) {
  const { t } = useTranslation()
  const money = (value: number) => formatCurrency(value, { locale, currency })
  const transactionName = repayment.transaction.merchantName ?? repayment.transaction.description
  const transactionDate = repayment.transaction.date ? formatDate(repayment.transaction.date, locale) : null
  return <View style={[styles.repayment, { borderColor: palette.border, backgroundColor: palette.card }]}><View style={styles.repaymentTop}><View style={styles.repaymentHeading}><Text allowFontScaling style={[styles.repaymentDate, { color: palette.foreground }]}>{formatDate(repayment.paymentDate, locale)}</Text>{transactionName ? <Text allowFontScaling style={[styles.small, { color: palette.mutedForeground }]}>{transactionName}</Text> : null}</View><Text allowFontScaling style={[styles.total, { color: palette.foreground }]}>{money(repayment.total)}</Text></View><View style={styles.allocations}><Allocation label={t('loanDetail.principal')} value={money(repayment.principal)} palette={palette} /><Allocation label={t('loanDetail.interest')} value={money(repayment.interest)} palette={palette} /><Allocation label={t('loanDetail.fee')} value={money(repayment.fee)} palette={palette} /></View><Text allowFontScaling style={[styles.small, { color: palette.mutedForeground }]}>{t('loanDetail.totalNote')}</Text>{repayment.transaction.settlementAmount !== null ? <Text allowFontScaling style={[styles.transaction, { color: palette.mutedForeground }]}>{t('loanDetail.transactionAmountNoCurrency', { value: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(repayment.transaction.settlementAmount) })}</Text> : null}{transactionDate ? <Text allowFontScaling style={[styles.transaction, { color: palette.mutedForeground }]}>{t('loanDetail.transactionDate', { date: transactionDate })}</Text> : null}{repayment.notes ? <Text allowFontScaling style={[styles.transaction, { color: palette.mutedForeground }]}>{repayment.notes}</Text> : null}{repayment.needsReview ? <Text allowFontScaling style={[styles.review, { color: palette.destructive }]}>{t('loanDetail.needsReview')}</Text> : null}</View>
}

function Allocation({ label, value, palette }: { label: string; value: string; palette: Palette }) {
  return <View accessible accessibilityLabel={`${label}, ${value}`} style={styles.allocation}><Text allowFontScaling style={[styles.allocationLabel, { color: palette.mutedForeground }]}>{label}</Text><Text allowFontScaling style={[styles.allocationValue, { color: palette.foreground }]}>{value}</Text></View>
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 }, content: { flexGrow: 1, padding: themeTokens.layout.screenPadding }, page: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: themeTokens.layout.blockGap }, editButton: { alignSelf: 'flex-start' }, hero: { gap: themeTokens.spacing[2] }, kicker: { ...textStyles.label, fontWeight: '600' as const }, heroAmount: { ...textStyles.display }, currency: { ...textStyles.amountSmall }, track: { height: 4, borderRadius: themeTokens.radius.pill, overflow: 'hidden', marginTop: themeTokens.spacing[2] }, fill: { height: '100%', borderRadius: themeTokens.radius.pill }, progressText: { ...textStyles.meta }, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[3] }, metric: { width: '48%', flexGrow: 1, minWidth: 145, borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[1] }, metricValue: { ...textStyles.amount }, small: { ...textStyles.label },
  context: { borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[2] }, sectionTitle: { ...textStyles.section }, detailRow: { borderTopWidth: 1, paddingTop: themeTokens.spacing[3], gap: themeTokens.spacing[1] }, detailLabel: { ...textStyles.label }, detailValue: { ...textStyles.body }, history: { gap: themeTokens.spacing[4] }, sectionHeading: { gap: themeTokens.spacing[1] }, historyState: { ...textStyles.body, borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[5] }, repaymentList: { gap: themeTokens.spacing[3] }, repayment: { borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] }, repaymentTop: { flexDirection: 'row', justifyContent: 'space-between', gap: themeTokens.spacing[3] }, repaymentHeading: { flex: 1, gap: themeTokens.spacing[1] }, repaymentDate: { ...textStyles.action }, total: { ...textStyles.amount }, allocations: { flexDirection: 'row', gap: themeTokens.spacing[3] }, allocation: { flex: 1, gap: themeTokens.spacing[1] }, allocationLabel: { ...textStyles.label }, allocationValue: { ...textStyles.amountSmall }, transaction: { ...textStyles.label }, review: { ...textStyles.label, fontWeight: '600' as const },
})
