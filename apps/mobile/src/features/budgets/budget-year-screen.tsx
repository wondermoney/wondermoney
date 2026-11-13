import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native'

import { HeadlineFigure } from '@/components/ui/headline-figure'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Section } from '@/components/ui/section'
import { Text } from '@/components/ui/text'
import { useFormatMoney, useMoneyLabel } from '@/lib/formatters/money-display'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { BudgetDetailHeader, BudgetLine, BudgetOverviewTable, type BudgetView } from './budget-parts'
import { budgetMeasureScale, type BudgetYearViewModel } from './budgets-view-model'
import { BudgetFailure, BudgetLoading, StaleBanner } from './budgets-screen'

export type BudgetYearViewState =
  | { status: 'loading' | 'access-transition' }
  | { status: 'error' | 'invalid-response' | 'not-found' | 'invalid-route' }
  | { status: 'loaded' | 'refresh-error'; year: BudgetYearViewModel; toDate: BudgetYearViewModel | null; refreshing?: boolean }

export type BudgetYearScreenProps = Readonly<{
  state: BudgetYearViewState
  onBack: () => void
  onRetry: () => void | Promise<void>
  /** Web's "Accounts linked" button; omitted, the header has none. */
  onManageAccounts?: () => void
  /** The "Month" segment of web's "View by" control. */
  onViewMonth?: () => void
}>

/**
 * The year view: the budget header, the planned yearly result as the headline figure with the
 * planned income and expenses beside it, then the year and the Month | Year control; the annual
 * budget lines as flat rows in an open section (no row actions, as web's `noActions`), then
 * Year to Date against Full year.
 */
export function BudgetYearScreen({ state, onBack, onRetry, onManageAccounts, onViewMonth }: BudgetYearScreenProps) {
  const moneyLabel = useMoneyLabel()
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  if (state.status === 'access-transition') return null
  if (state.status === 'loading') return <BudgetLoading label={t('budgetYear.loading')} palette={palette} />
  if (state.status !== 'loaded' && state.status !== 'refresh-error') {
    const copyKey = state.status === 'invalid-response' ? 'invalid' : state.status === 'not-found' ? 'notFound' : state.status === 'invalid-route' ? 'invalidRoute' : 'error'
    return <BudgetFailure title={t(`budgetYear.${copyKey}Title`)} message={t(`budgetYear.${copyKey}Message`)} onRetry={state.status === 'invalid-route' ? undefined : onRetry} onBack={onBack} backLabel={t('budgetYear.back')} palette={palette} />
  }
  const { year: full, toDate } = state
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const result = full.totalIncome - full.totals.planned
  const scaleMax = budgetMeasureScale(full.categories)
  const onChangeView = onViewMonth ? (view: BudgetView) => { if (view === 'month') onViewMonth() } : undefined

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={Boolean(state.refreshing)} onRefresh={() => void onRetry()} tintColor={palette.primary} />}>
        <View style={styles.page}>
          <BudgetDetailHeader
            accountCount={full.accounts.length}
            figure={(
              <View style={styles.lead}>
                {state.status === 'refresh-error' ? <StaleBanner label={t('budgetYear.stale')} palette={palette} /> : null}
                <HeadlineFigure
                  accessibilityLabel={`${t('budgetYear.yearlyResult')}, ${moneyLabel(result, { locale, currency: full.currencyCode })}`}
                  currency={full.currencyCode}
                  label={t('budgetYear.yearlyResult')}
                  labelIsHeader
                  locale={locale}
                  size="md"
                  value={result}
                />
                <View style={styles.stats}>
                  <YearStat label={t('budgetYear.incomePlanned')} value={full.totalIncome} currency={full.currencyCode} locale={locale} />
                  <YearStat label={t('budgetYear.expensesPlanned')} value={full.totals.planned} currency={full.currencyCode} locale={locale} />
                </View>
              </View>
            )}
            helpText={t('budgetYear.help')}
            lead={<Text accessibilityRole="header" variant="bodyStrong">{String(full.year)}</Text>}
            name={full.name}
            onBack={onBack}
            onChangeView={onChangeView}
            onManageAccounts={onManageAccounts}
            personal={full.visibility === 'personal'}
            view="year"
          />

          <Section title={t('budgetMonth.categories')} variant="open">
            <View>
              {full.categories.length === 0 ? (
                <Text style={styles.empty} tone="muted" variant="meta">{t('budgetYear.noCategories')}</Text>
              ) : full.categories.map((category, index) => (
                <Fragment key={category.id}>
                  <BudgetLine category={category} currency={full.currencyCode} locale={locale} scaleMax={scaleMax} separated={index > 0} view="year" />
                  {category.children.map((child) => (
                    <BudgetLine key={child.id} category={child} currency={full.currencyCode} indented locale={locale} scaleMax={scaleMax} separated view="year" />
                  ))}
                </Fragment>
              ))}
            </View>
          </Section>

          <BudgetOverviewTable
            currency={full.currencyCode}
            locale={locale}
            rows={[
              ...(toDate ? [{ name: t('budgetYear.yearToDate'), spent: toDate.totals.spent, budgeted: toDate.totals.planned }] : []),
              { name: t('budgetYear.fullYear'), spent: full.totals.spent, budgeted: full.totals.planned },
            ]}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

/** One of the three planned totals: a muted label over a mono figure, a third of the row. */
function YearStat({ label, value, currency, locale }: { label: string; value: number; currency: string; locale: string }) {
  const formatMoney = useFormatMoney()
  const money = formatMoney(value, { locale, currency })
  return (
    <View accessible accessibilityLabel={`${label}, ${money}`} style={styles.stat}>
      <Text numberOfLines={2} tone="muted" variant="meta">{label}</Text>
      <Text adjustsFontSizeToFit minimumFontScale={0.6} numberOfLines={1} tone={value < 0 ? 'destructive' : 'default'} variant="amountBase">{money}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[8] },
  page: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: themeTokens.spacing[10] },
  lead: { gap: themeTokens.spacing[4] },
  stats: { flexDirection: 'row', gap: themeTokens.spacing[4] },
  stat: { flex: 1, minWidth: 0, justifyContent: 'space-between' },
  empty: { paddingVertical: themeTokens.spacing[6] },
})
