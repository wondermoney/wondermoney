import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { Amount } from '@/components/ui/amount'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { List, ListRow } from '@/components/ui/list-row'
import { Section } from '@/components/ui/section'
import { Text } from '@/components/ui/text'
import { useFormatMoney } from '@/lib/formatters/money-display'
import { themeTokens } from '@/theme/tokens'
import type { SectionState } from '@/features/accounts/accounts-screen'
import { SectionMessage } from '@/features/accounts/screen-states'

import type { InstallmentCommitmentDto, InstallmentPlanDto, InstallmentSuggestionDto } from './installments-contract'
import { formatPlanDay } from './installment-ui'

export type InstallmentPlansSectionState = Readonly<{
  /** The card's commitment; `null` when it has no plan with an installment still to come. */
  commitment: SectionState<InstallmentCommitmentDto | null>
  plans: SectionState<readonly InstallmentPlanDto[]>
  suggestions: SectionState<readonly InstallmentSuggestionDto[]>
}>

export type InstallmentPlansSectionProps = Readonly<{
  state: InstallmentPlansSectionState
  locale: string
  onOpenPlan: (planId: number) => void
  /** Omitted (an account the caller can only view), plans and suggestions only show. */
  onCreatePlan?: () => void
  onAcceptSuggestion?: (suggestionKey: string) => void
}>

/**
 * A card's installment purchases on its page: what the plans still have to charge, each plan
 * (opening its schedule) and the posted rows that look like installments of a purchase with no
 * plan yet. What is still to come is a projection, so it is stated as one: never a transaction,
 * never in the balance.
 */
export function InstallmentPlansSection({ state, locale, onOpenPlan, onCreatePlan, onAcceptSuggestion }: InstallmentPlansSectionProps) {
  const { t } = useTranslation()
  const plans = state.plans.status === 'loaded' ? state.plans.data : null
  // Suggestions are offers to add a plan, so a view-only account shows none.
  const suggestions = state.suggestions.status === 'loaded' && onAcceptSuggestion ? state.suggestions.data : []

  return (
    <Section
      action={onCreatePlan ? <Button label={t('installments.create.action')} onPress={onCreatePlan} size="sm" variant="link" /> : undefined}
      testID="installment-plans"
      title={t('installments.title')}
      variant="open"
    >
      <View style={styles.body}>
        <Commitment locale={locale} state={state.commitment} />

        {state.plans.status === 'loading' ? <SectionMessage loading /> : null}
        {state.plans.status === 'error' ? <SectionMessage message={t('installments.plansError')} /> : null}
        {plans && plans.length > 0 ? (
          <List divided>
            {plans.map((plan) => <PlanRow key={plan.installmentPlanKey} locale={locale} onPress={() => onOpenPlan(plan.installmentPlanKey)} plan={plan} />)}
          </List>
        ) : null}
        {plans && plans.length === 0 && suggestions.length === 0 ? (
          <Text tone="muted" variant="meta">{t('installments.empty')}</Text>
        ) : null}

        {suggestions.length > 0 && onAcceptSuggestion ? (
          <View style={styles.suggestions} testID="installment-suggestions">
            <Text accessibilityRole="header" variant="metaStrong">{t('installments.suggestions.title')}</Text>
            <Text tone="muted" variant="label">{t('installments.suggestions.helper')}</Text>
            <List divided>
              {suggestions.map((suggestion) => (
                <SuggestionRow key={suggestion.key} locale={locale} onAccept={() => onAcceptSuggestion(suggestion.key)} suggestion={suggestion} />
              ))}
            </List>
          </View>
        ) : null}

        <Text tone="muted" variant="label">{t('installments.projectionNote')}</Text>
      </View>
    </Section>
  )
}

function Commitment({ state, locale }: { state: InstallmentPlansSectionState['commitment']; locale: string }) {
  const { t } = useTranslation()
  const formatMoney = useFormatMoney()
  if (state.status === 'loading') return <SectionMessage loading />
  if (state.status === 'error') return <SectionMessage message={t('installments.commitmentError')} />
  const commitment = state.data
  if (!commitment || commitment.remainingCount === 0) return null
  const next = commitment.nextInstallment
  const amount = formatMoney(commitment.remainingAmount, { locale, currency: commitment.currency })
  const spread = `${t('installments.remainingCount', { count: commitment.remainingCount })} · ${t('installments.activePlans', { count: commitment.activePlanCount })}`
  const nextLine = next
    ? t('installments.next', {
        amount: formatMoney(next.amount, { locale, currency: commitment.currency }),
        date: formatPlanDay(next.date, locale),
        name: `${next.description} ${next.installmentNumber}/${next.installmentCount}`,
      })
    : null
  return (
    <View accessibilityLabel={[`${t('installments.commitment')}, ${amount}`, spread, nextLine].filter(Boolean).join(', ')} accessible style={styles.commitment} testID="installment-commitment">
      <Text tone="muted" variant="label">{t('installments.commitment')}</Text>
      <Amount currency={commitment.currency} locale={locale} size="stat" value={commitment.remainingAmount} />
      <Text tone="muted" variant="meta">{spread}</Text>
      {nextLine ? <Text tone="muted" variant="meta">{nextLine}</Text> : null}
    </View>
  )
}

function PlanRow({ plan, locale, onPress }: { plan: InstallmentPlanDto; locale: string; onPress: () => void }) {
  const { t } = useTranslation()
  const formatMoney = useFormatMoney()
  const finished = plan.remainingCount === 0 && (plan.unmatchedCount ?? 0) === 0
  const paid = t('installments.paidCount', { paid: plan.paidCount, total: plan.installmentCount })
  const next = plan.nextInstallment ? t('installments.nextDate', { date: formatPlanDay(plan.nextInstallment.scheduledDate, locale) }) : null
  const remaining = formatMoney(plan.remainingAmount, { locale, currency: plan.currency })
  return (
    <ListRow
      accessibilityLabel={[plan.description, `${t('installments.remaining')} ${remaining}`, paid, next, finished ? t('installments.finished') : null].filter(Boolean).join(', ')}
      badge={finished ? <Badge label={t('installments.finished')} tone="success" /> : undefined}
      figure={<Amount currency={plan.currency} locale={locale} value={plan.remainingAmount} />}
      figureMeta={<Text tone="muted" variant="label">{t('installments.remaining')}</Text>}
      meta={[paid, next]}
      onPress={onPress}
      testID={`installment-plan-${plan.installmentPlanKey}`}
      title={plan.description}
    />
  )
}

function SuggestionRow({ suggestion, locale, onAccept }: { suggestion: InstallmentSuggestionDto; locale: string; onAccept: () => void }) {
  const { t } = useTranslation()
  const formatMoney = useFormatMoney()
  const each = formatMoney(suggestion.installmentAmount, { locale, currency: suggestion.currency })
  // The action sits under the row, not inside it: a row that is not pressable reads as one
  // element, and a screen reader would not reach a button within it.
  return (
    <View style={styles.suggestion}>
      <ListRow
        figure={<Amount currency={suggestion.currency} locale={locale} value={suggestion.totalAmount} />}
        meta={[
          t('installments.suggestions.schedule', { total: suggestion.installmentCount, amount: each }),
          t('installments.suggestions.found', { count: suggestion.transactions.length, date: formatPlanDay(suggestion.purchaseDate, locale) }),
        ]}
        testID={`installment-suggestion-${suggestion.key}`}
        title={suggestion.description}
      />
      <View style={styles.suggestionAction}>
        <Button
          accessibilityLabel={t('installments.suggestions.acceptNamed', { name: suggestion.description })}
          label={t('installments.suggestions.accept')}
          onPress={onAccept}
          size="sm"
          variant="secondary"
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  body: { gap: themeTokens.spacing[4] },
  commitment: { gap: themeTokens.spacing[1] },
  suggestions: { gap: themeTokens.spacing[2] },
  suggestion: { paddingBottom: themeTokens.spacing[3] },
  suggestionAction: { flexDirection: 'row' },
})
