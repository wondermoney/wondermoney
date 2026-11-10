import { useRef } from 'react'
import { RefreshControl, ScrollView, StyleSheet, View, type ScrollViewInstance } from 'react-native'
import { useTranslation } from 'react-i18next'

import { Amount } from '@/components/ui/amount'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EntityMark } from '@/components/ui/entity-mark'
import { HeadlineFigure } from '@/components/ui/headline-figure'
import { IconButton } from '@/components/ui/icon-button'
import { ListRow } from '@/components/ui/list-row'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Section } from '@/components/ui/section'
import { Stat, StatList, StatValue } from '@/components/ui/stat'
import { Text } from '@/components/ui/text'
import { formatTransactionDate } from '@/lib/dates/transaction-date'
import { useFormatMoney } from '@/lib/formatters/money-display'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import type { LoanRepaymentViewModel, LoanViewModel } from './loans-view-model'
import { Alert, Failure, formatDate, Header, Loading, LoanProgress } from './loans-screen'
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

type RepaymentWorkflowProps = { candidates: CandidateState; pending: boolean; refreshRequired: boolean; onWrite: (write: FrozenRepaymentWrite) => Promise<RepaymentWriteFailure | 'success'>; onRefreshCandidates: () => void | Promise<void>; onResolveUnknown: () => Promise<boolean> }

/**
 * Web's loan detail (`loans/[loanId]/loan-detail-client.tsx`) at phone width, in the calm
 * structure: "← Loans"; the loan's mark, name and provider with Edit loan as the title row's one
 * glyph; Outstanding principal as the headline figure with the next payment as its status line;
 * Link repayment as the one control; Regular payment, Annual rate, Remaining term and Repayment
 * progress as a stat list; then Repayments and Loan assumptions as open sections. Linking (web's
 * drawer) sits under Repayments here.
 */
export function LoanDetailScreen({ state, onBack, onEdit = () => {}, onRefresh, repaymentWorkflow }: { state: LoanDetailViewState; onBack: () => void; onEdit?: () => void; onRefresh: () => void | Promise<void>; repaymentWorkflow?: RepaymentWorkflowProps }) {
  const formatMoney = useFormatMoney()
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const scroll = useRef<ScrollViewInstance>(null)
  const workflowY = useRef(0)
  if (state.status === 'access-transition') return null
  if (state.status === 'loading') return <Loading label={t('loanDetail.loading')} />
  if (state.status === 'error' || state.status === 'invalid-response' || state.status === 'not-found' || state.status === 'invalid-id') {
    const key = state.status === 'invalid-response' ? 'invalid' : state.status === 'not-found' ? 'notFound' : state.status === 'invalid-id' ? 'invalidId' : 'error'
    return <Failure title={t(`loanDetail.${key}Title`)} message={t(`loanDetail.${key}Message`)} onRetry={state.status === 'invalid-id' ? undefined : onRefresh} onBack={onBack} fallback="/loans" backLabel={t('loanDetail.back')} />
  }
  const { loan } = state
  const money = (value: number) => formatMoney(value, { locale, currency: loan.currencyCode })
  const percent = (value: number, digits = 0) => new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value / 100)
  const remaining = loan.remainingTerm
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView ref={scroll} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={Boolean(state.refreshing)} onRefresh={() => void onRefresh()} tintColor={palette.primary} />}>
        <View style={styles.page}>
          <View style={styles.header}>
            <Header
              title={loan.name}
              descriptor={loan.providerName ?? t('loanDetail.providerUnavailable')}
              badge={loan.status !== 'ACTIVE' ? <Badge label={t(`loans.status.${loan.status}`)} tone="muted" /> : undefined}
              fallback="/loans"
              backLabel={t('loanDetail.back')}
              onBack={onBack}
              leading={<EntityMark glyph="receipt-text" />}
              // The only secondary action, so its own glyph rather than a one-item menu.
              action={<IconButton accessibilityLabel={t('loanDetail.editLoan')} icon="pencil" onPress={onEdit} style={styles.overflow} />}
              figure={(
                <View style={styles.figure}>
                  <HeadlineFigure
                    currency={loan.currencyCode}
                    label={t('loans.outstanding')}
                    locale={locale}
                    size="md"
                    status={loan.nextPaymentDate ? { label: `${t('loans.nextPayment')} ${formatDate(loan.nextPaymentDate, locale)}` } : undefined}
                    value={loan.outstanding}
                  />
                </View>
              )}
            />
            {state.status === 'refresh-error' ? <Alert label={t('loanDetail.stale')} /> : null}
            {repaymentWorkflow ? (
              <View style={styles.actions}>
                <Button icon="link" label={t('loanDetail.linkRepayment')} onPress={() => scroll.current?.scrollTo({ y: workflowY.current, animated: true })} />
              </View>
            ) : null}
          </View>

          <StatList>
            <Stat label={t('loanDetail.regularPayment')} value={loan.regularPayment} currency={loan.currencyCode} locale={locale} helper={loan.regularPayment !== null ? t(`loans.frequency.${loan.paymentFrequency}`) : undefined} />
            <Stat label={t('loanDetail.annualRate')} locale={locale} valueNode={<StatValue>{loan.annualRatePercent !== null ? percent(loan.annualRatePercent, 2) : '—'}</StatValue>} helper={loan.annualRatePercent !== null ? t(`loanDetail.rateType.${loan.rateType}`) : undefined} />
            <Stat
              label={t(remaining?.basis === 'estimate' ? 'loanDetail.remainingTerm' : 'loanDetail.remainingTermContract')}
              locale={locale}
              valueNode={<StatValue>{remaining ? t('loanDetail.monthCount', { count: remaining.months }) : '—'}</StatValue>}
              helper={loan.payoffBeyondContractMonths !== null ? <Text accessibilityRole="alert" testID="loan-payoff-beyond-contract" tone="warning" variant="label">{t('loanDetail.payoffBeyondContract', { count: loan.payoffBeyondContractMonths })}</Text> : undefined}
            />
            <Stat
              label={t('loanDetail.repaymentProgress')}
              locale={locale}
              valueNode={<StatValue>{percent(loan.meterPercentage)}</StatValue>}
              helper={(
                <View style={styles.progressHelper}>
                  <LoanProgress testID="loan-progress" value={loan.meterPercentage} label={t('loans.progressRepaid', { value: Math.round(loan.meterPercentage) })} />
                  <Text tone="muted" variant="label">{t('loanDetail.progressValue', { value: percent(loan.progressPercentage, 2), basis: t(`loanDetail.progressBasis.${loan.progressBasis}`) })}</Text>
                </View>
              )}
            />
          </StatList>

          <RepaymentHistory state={state.history} currency={loan.currencyCode} locale={locale} />

          {repaymentWorkflow ? (
            <View onLayout={(event) => { workflowY.current = event.nativeEvent.layout.y }}>
              <LoanRepaymentWorkflow loan={loan} candidates={repaymentWorkflow.candidates} repayments={'repayments' in state.history ? state.history.repayments : []} pending={repaymentWorkflow.pending} refreshRequired={repaymentWorkflow.refreshRequired} onWrite={repaymentWorkflow.onWrite} onRefreshCandidates={repaymentWorkflow.onRefreshCandidates} onResolveUnknown={repaymentWorkflow.onResolveUnknown} />
            </View>
          ) : null}

          <Section title={t('loanDetail.assumptions')} variant="open">
            <View>
              <DetailRow first label={t('loanDetail.lender')} value={loan.providerName ?? t('loanDetail.providerUnavailable')} />
              <DetailRow label={t('loanDetail.loanType')} value={t(`loans.type.${loan.type}`)} />
              <DetailRow label={t('loanDetail.statusLabel')} value={t(`loans.status.${loan.status}`)} />
              <DetailRow label={t('loanDetail.description')} value={loan.notes ?? '—'} />
              {/* Mobile-only terms web keeps in its edit drawer, listed after web's four. */}
              <DetailRow label={t('loanDetail.openingBalance')} value={money(loan.openingBalance)} figure />
              {loan.originalPrincipal !== null ? <DetailRow label={t('loanDetail.originalPrincipal')} value={money(loan.originalPrincipal)} figure /> : null}
              {loan.termMonths !== null ? <DetailRow label={t('loanDetail.term')} value={t('loanDetail.monthCount', { count: loan.termMonths })} /> : null}
              <DetailRow label={t('loanDetail.openingDate')} value={formatDate(loan.openingBalanceDate, locale)} />
              {loan.nextPaymentDate ? <DetailRow label={t('loanDetail.nextPayment')} value={formatDate(loan.nextPaymentDate, locale)} /> : null}
              {loan.paymentDay ? <DetailRow label={t('loanDetail.paymentDay')} value={String(loan.paymentDay)} /> : null}
              {loan.maturityDate ? <DetailRow label={t('loanDetail.maturity')} value={formatDate(loan.maturityDate, locale)} /> : null}
            </View>
          </Section>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

/** Web `LoanAssumptionsCard` row: muted label left, value right, hairline under (`py-2.5 text-sm`). */
function DetailRow({ label, value, figure = false, first = false }: { label: string; value: string; figure?: boolean; first?: boolean }) {
  const palette = usePalette()
  return (
    <View accessible accessibilityLabel={`${label}, ${value}`} style={[styles.detailRow, { borderBottomColor: palette.border }, first && styles.firstRow]}>
      <Text style={styles.detailLabel} tone="muted" variant="meta">{label}</Text>
      <Text style={styles.detailValue} variant={figure ? 'amount' : 'meta'}>{value}</Text>
    </View>
  )
}

/** Web `LoanRepaymentsTable` at phone width: one row per repayment, its split beneath. */
function RepaymentHistory({ state, currency, locale }: { state: HistoryState; currency: string; locale: string }) {
  const { t } = useTranslation()
  return (
    <Section title={t('loanDetail.repaymentsTitle')} variant="open">
      <Text tone="muted" variant="meta">{t('loanDetail.repaymentsHelper')}</Text>
      {state.status === 'loading' ? <Text accessible accessibilityLabel={t('loanDetail.repaymentsLoading')} accessibilityRole="progressbar" tone="muted" variant="meta">{t('loanDetail.repaymentsLoading')}</Text>
        : state.status === 'error' || state.status === 'invalid-response' ? <Alert label={t(state.status === 'invalid-response' ? 'loanDetail.repaymentsInvalid' : 'loanDetail.repaymentsError')} />
          : (
            <>
              {state.status === 'refresh-error' ? <Alert label={t('loanDetail.repaymentsStale')} /> : null}
              {state.repayments.length === 0 ? (
                <View style={styles.emptyHistory}>
                  <Text variant="metaStrong">{t('loanDetail.repaymentsEmptyTitle')}</Text>
                  <Text tone="muted" variant="meta">{t('loanDetail.repaymentsEmptyMessage')}</Text>
                </View>
              ) : (
                <View>
                  {state.repayments.map((repayment, index) => <RepaymentRow key={repayment.id} repayment={repayment} currency={currency} locale={locale} separated={index > 0} />)}
                  <Text style={styles.totalNote} tone="muted" variant="label">{t('loanDetail.totalNote')}</Text>
                </View>
              )}
            </>
          )}
    </Section>
  )
}

function RepaymentRow({ repayment, currency, locale, separated }: { repayment: LoanRepaymentViewModel; currency: string; locale: string; separated: boolean }) {
  const formatMoney = useFormatMoney()
  const { t } = useTranslation()
  const money = (value: number) => formatMoney(value, { locale, currency })
  const transactionName = repayment.transaction.merchantName ?? repayment.transaction.description
  const transactionDate = repayment.transaction.date ? formatTransactionDate(repayment.transaction.date, locale) : null
  return (
    <ListRow
      badge={repayment.needsReview ? <Text tone="warning" variant="label">{t('loanDetail.needsReview')}</Text> : undefined}
      figure={<Amount currency={currency} locale={locale} size="amount" value={repayment.total} />}
      meta={[formatDate(repayment.paymentDate, locale), repayment.notes]}
      separated={separated}
      title={transactionName ?? formatDate(repayment.paymentDate, locale)}
    >
      <View style={styles.allocations}>
        <Allocation label={t('loanDetail.principal')} value={money(repayment.principal)} />
        <Allocation label={t('loanDetail.interest')} value={money(repayment.interest)} />
        <Allocation label={t('loanDetail.fee')} value={money(repayment.fee)} />
      </View>
      {repayment.transaction.settlementAmount !== null ? <Text tone="muted" variant="label">{t('loanDetail.transactionAmountNoCurrency', { value: formatMoney(repayment.transaction.settlementAmount, { locale, currency: null, minimumFractionDigits: 0, maximumFractionDigits: 2 }) })}</Text> : null}
      {transactionDate ? <Text tone="muted" variant="label">{t('loanDetail.transactionDate', { date: transactionDate })}</Text> : null}
    </ListRow>
  )
}

function Allocation({ label, value }: { label: string; value: string }) {
  return (
    <View accessible accessibilityLabel={`${label}, ${value}`} style={styles.allocation}>
      <Text tone="muted" variant="label">{label}</Text>
      <Text variant="amountSmall">{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[12] },
  page: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: themeTokens.spacing[10] },
  header: { gap: themeTokens.spacing[6] },
  figure: { paddingTop: themeTokens.spacing[4] },
  overflow: { marginRight: -11, marginVertical: -6 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
  progressHelper: { gap: themeTokens.spacing[2], paddingTop: themeTokens.spacing[1] },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: themeTokens.spacing[4], paddingVertical: themeTokens.spacing[3], borderBottomWidth: 1 },
  firstRow: {},
  detailLabel: { flexShrink: 0, maxWidth: '50%' },
  detailValue: { flexShrink: 1, textAlign: 'right' },
  emptyHistory: { gap: themeTokens.spacing[1] },
  totalNote: { paddingTop: themeTokens.spacing[3] },
  allocations: { flexDirection: 'row', gap: themeTokens.spacing[3], paddingTop: themeTokens.spacing[2] },
  allocation: { flex: 1, gap: 2 },
})
