import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'

import { Amount } from '@/components/ui/amount'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EntityMark, portfolioMark, type EntityMarkSource } from '@/components/ui/entity-mark'
import { FxStatusLabel } from '@/components/ui/fx-status-label'
import { Icon } from '@/components/ui/icon'
import { List, ListRow } from '@/components/ui/list-row'
import { Section } from '@/components/ui/section'
import { Text } from '@/components/ui/text'
import type { InsightDto, SpendingVsNormalFactsDto } from '@/features/insights/insights-contract'
import type { LoanDto } from '@/features/loans/loans-contract'
import { transactionMark } from '@/features/transactions/transaction-mark'
import type { TransactionDto, TransactionReviewSummaryDto } from '@/features/transactions/transactions-contract'
import { resolveFxState } from '@/lib/api/fx-status'
import { transactionDisplayDate } from '@/lib/dates/transaction-date'
import { formatCategoryName } from '@/lib/formatters/category-name'
import { useFormatMoney, useMoneyLabel } from '@/lib/formatters/money-display'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import {
  calendarDay,
  daysLeftInMonth,
  formatMonthName,
  formatPercentagePoints,
  formatSavingsRate,
  formatShortDate,
  measureGeometry,
  type BalanceSheet,
  type BalanceSheetGroup,
  type CashflowView,
  type MonthSummary,
  type SavingsSummary,
} from './home-model'

/** A Home section loads, fails and retries on its own, as on web. */
export type SectionState<T> =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'loaded'; data: T }

type Navigate = (href: string) => void

// ── Shared section states (web RowsSkeleton, DataLoadError, SectionEmpty) ──

export function RowsSkeleton({ rows, label }: { rows: number; label: string }) {
  const palette = usePalette()
  return (
    <View accessible accessibilityLabel={label} accessibilityRole="progressbar">
      {Array.from({ length: rows }, (_, index) => (
        <View key={index} style={[styles.skeletonRow, { borderBottomColor: palette.border }]}>
          <View style={[styles.skeletonBar, { width: '40%', backgroundColor: palette.muted }]} />
          <View style={[styles.skeletonBar, { width: 80, backgroundColor: palette.muted }]} />
        </View>
      ))}
    </View>
  )
}

export function SectionError({ onRetry, message }: { onRetry: () => void; message?: string }) {
  const { t } = useTranslation()
  return (
    <Card density="standalone">
      <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.errorBody}>
        <Text variant="subheading">{t('home.errorTitle')}</Text>
        <Text tone="muted" variant="meta">{message ?? t('netWorth.errorMessage')}</Text>
      </View>
      <View style={styles.errorAction}>
        <Button icon="refresh-cw" label={t('home.tryAgain')} onPress={onRetry} variant="outline" />
      </View>
    </Card>
  )
}

export function SectionEmpty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  const palette = usePalette()
  return (
    <View style={[styles.empty, { borderBottomColor: palette.border }]}>
      <Text variant="bodyStrong">{title}</Text>
      <Text tone="muted" variant="meta">{body}</Text>
      {action ? <View style={styles.emptyAction}>{action}</View> : null}
    </View>
  )
}

// ── Setup checklist (web SetupChecklistCard) ──────────────────────────────

export type SetupSteps = Readonly<{ account: boolean; transactions: boolean; budget: boolean; portfolio: boolean }>

const SETUP_STEPS = [
  { key: 'account', href: '/accounts' },
  { key: 'transactions', href: '/accounts/transactions' },
  { key: 'budget', href: '/budgets' },
  { key: 'portfolio', href: '/portfolio' },
] as const

export function SetupChecklist({ steps, onDismiss, onNavigate }: { steps: SetupSteps; onDismiss: () => void; onNavigate: Navigate }) {
  const { t } = useTranslation()
  const palette = usePalette()
  const [expanded, setExpanded] = useState(false)
  const completed = SETUP_STEPS.filter((step) => steps[step.key]).length
  const total = SETUP_STEPS.length
  if (completed === total) return null
  const remaining = total - completed

  return (
    <Card testID="home-setup-checklist">
      <View style={styles.setupHead}>
        <View style={styles.setupCopy}>
          <Text variant="metaStrong">{t('home.setup.title')}</Text>
          <Text tone="muted" variant="meta">{t('home.setup.count', { completed, total })}</Text>
          <Text tone="muted" variant="meta">{remaining === 1 ? t('home.setup.nudgeOne') : t('home.setup.nudgeMany')}</Text>
        </View>
        <View style={styles.setupControls}>
          {/* The icon set has no chevron-up yet: the open state turns the chevron over. */}
          <View accessibilityState={{ expanded }} style={expanded ? styles.flipped : null}>
            <Button
              accessibilityLabel={expanded ? t('home.setup.hideSteps') : t('home.setup.viewSteps')}
              icon="chevron-down"
              label={expanded ? t('home.setup.hideSteps') : t('home.setup.viewSteps')}
              onPress={() => setExpanded((current) => !current)}
              size="icon"
              variant="secondary"
            />
          </View>
          <Button icon="x" label={t('home.setup.hideForNow')} onPress={onDismiss} size="icon" variant="ghost" />
        </View>
      </View>
      <View
        accessibilityLabel={t('home.setup.title')}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: total, now: completed }}
        style={[styles.progressTrack, { backgroundColor: palette.muted }]}
      >
        <View style={[styles.progressFill, { width: `${(completed / total) * 100}%`, backgroundColor: palette.primary }]} />
      </View>
      {expanded ? (
        <View style={[styles.setupSteps, { borderTopColor: palette.border }]}>
          {SETUP_STEPS.map((step) => {
            const done = steps[step.key]
            const label = t(`home.setup.steps.${step.key}`)
            return (
              <Pressable
                key={step.key}
                accessibilityLabel={`${label}, ${done ? t('home.setup.complete') : t('home.setup.incomplete')}`}
                accessibilityRole="link"
                onPress={() => onNavigate(step.href)}
                style={({ pressed }) => [styles.setupStep, pressed && { backgroundColor: palette.muted }]}
              >
                {done ? (
                  <Icon color={palette.successText} name="check" />
                ) : (
                  <View style={[styles.stepCircle, { borderColor: palette.mutedForeground }]} />
                )}
                <Text style={styles.flex} tone={done ? 'muted' : 'default'} variant={done ? 'meta' : 'metaStrong'}>{label}</Text>
                {!done ? <Icon color={palette.mutedForeground} name="arrow-up-right" /> : null}
              </Pressable>
            )
          })}
        </View>
      ) : null}
    </Card>
  )
}

// ── This month (web ThisMonthSection) ─────────────────────────────────────

export type BudgetMonthRow = Readonly<{
  id: number
  name: string
  href: string
  state: SectionState<{ summary: MonthSummary; currency: string }>
  onRetry: () => void
}>

export function ThisMonthSection({ state, today, locale, onNavigate, onRetry }: {
  state: SectionState<readonly BudgetMonthRow[]>
  today: Date
  locale: string
  onNavigate: Navigate
  onRetry: () => void
}) {
  const { t } = useTranslation()
  const title = t('home.month.title')
  if (state.status === 'loading') {
    return <Section title={title} variant="open"><RowsSkeleton label={title} rows={2} /></Section>
  }
  if (state.status === 'error') {
    return <Section title={title} variant="open"><SectionError onRetry={onRetry} /></Section>
  }
  if (state.data.length === 0) {
    return (
      <Section title={title} variant="open">
        <SectionEmpty
          action={<Button label={t('home.month.emptyAction')} onPress={() => onNavigate('/budgets')} variant="secondary" />}
          body={t('home.month.emptyBody')}
          title={t('home.month.emptyTitle')}
        />
      </Section>
    )
  }
  const days = daysLeftInMonth(today)
  const month = formatMonthName(today, locale)
  const aside = days === 0 ? t('home.month.lastDay', { month }) : t('home.month.daysLeft', { count: days, month })
  return (
    <Section aside={aside} title={title} variant="open" testID="home-this-month">
      <View>
        {state.data.map((row, index) => (
          <BudgetMonthItem key={row.id} first={index === 0} locale={locale} onNavigate={onNavigate} row={row} />
        ))}
      </View>
    </Section>
  )
}

function BudgetMonthItem({ row, first, locale, onNavigate }: { row: BudgetMonthRow; first: boolean; locale: string; onNavigate: Navigate }) {
  const formatMoney = useFormatMoney()
  const { t } = useTranslation()
  const palette = usePalette()
  const name = (
    <Pressable accessibilityRole="link" hitSlop={8} onPress={() => onNavigate(row.href)} style={styles.budgetName}>
      <Text numberOfLines={1} variant="bodyStrong">{row.name}</Text>
    </Pressable>
  )
  const itemStyle = [styles.budgetItem, first && styles.firstItem, { borderBottomColor: palette.border }]

  if (row.state.status === 'loading') {
    return <View style={itemStyle}>{name}<RowsSkeleton label={row.name} rows={1} /></View>
  }
  if (row.state.status === 'error') {
    return (
      <View style={itemStyle}>
        {name}
        <View style={styles.inlineError}>
          <Text tone="muted" variant="meta">{t('home.month.rowError')}</Text>
          <Button label={t('home.tryAgain')} onPress={row.onRetry} size="sm" variant="secondary" />
        </View>
      </View>
    )
  }

  const { summary, currency } = row.state.data
  const geometry = measureGeometry(summary.spent, summary.planned)
  const money = (value: number) => formatMoney(value, { locale, currency })
  return (
    <View style={itemStyle} testID={`home-budget-${row.id}`}>
      <View style={styles.budgetHead}>
        {name}
        <View style={styles.budgetLeft}>
          {/* Web's `threshold` tone: a level, red only once it goes negative. */}
          <Amount currency={currency} delta={summary.left < 0} locale={locale} size="amountLarge" value={summary.left} />
          <Text tone="muted" variant="meta">{summary.isOverspent ? t('home.month.overspent') : t('home.month.left')}</Text>
        </View>
      </View>
      <View
        accessible
        accessibilityLabel={t('home.month.measureLabel', { name: row.name, spent: money(summary.spent), planned: money(summary.planned) })}
        accessibilityRole="image"
        style={styles.measure}
      >
        <View style={[styles.measurePlan, { width: `${geometry.plan}%`, backgroundColor: palette.border }]} />
        <View style={[styles.measureFill, { width: `${geometry.fill}%`, backgroundColor: palette.chart1 }]} />
        {geometry.over > 0 ? (
          <View style={[styles.measureOver, { left: `${geometry.plan}%`, width: `${geometry.over}%`, borderColor: palette.destructiveText, backgroundColor: palette.destructiveText }]} />
        ) : null}
        {geometry.plan > 0 ? <View style={[styles.measureMark, { left: `${geometry.plan}%`, backgroundColor: palette.foreground }]} /> : null}
      </View>
      <View style={styles.budgetFoot}>
        <View style={styles.inlineFigures}>
          <Amount currency={currency} locale={locale} size="amountSmall" value={summary.spent} />
          <Text tone="muted" variant="meta">{t('home.month.spentOf')}</Text>
          <Amount currency={currency} locale={locale} size="amountSmall" value={summary.planned} />
          <Text tone="muted" variant="meta">{t('home.month.planned')}</Text>
        </View>
        {summary.overPlanCount > 0 ? (
          <Text tone="destructive" variant="meta">{t('home.month.overPlan', { count: summary.overPlanCount })}</Text>
        ) : null}
      </View>
    </View>
  )
}

// ── Balance sheet (web BalanceSheetSection) ───────────────────────────────

export function BalanceSheetSection({ sheet, currency, locale, accountMarks, portfolioMarks, notice }: {
  sheet: BalanceSheet
  currency: string
  locale: string
  /** Each account's mark (institution logo or type glyph), by account key. */
  accountMarks?: ReadonlyMap<number, EntityMarkSource>
  /** Each portfolio's mark (its broker's letters), by portfolio key. */
  portfolioMarks?: ReadonlyMap<number, EntityMarkSource>
  /** Shown above the sheet, as web shows "Is this the same money?" there. */
  notice?: ReactNode
}) {
  const { t } = useTranslation()
  if (sheet.own.length === 0 && sheet.owe.length === 0) return null
  // A portfolio row already inside an account's balance names that account.
  const accountNames = new Map([...sheet.own, ...sheet.owe]
    .filter((group) => group.type === 'accounts')
    .flatMap((group) => group.rows.flatMap((row) => (row.id === undefined ? [] : [[row.id, row.label] as const]))))
  return (
    <Section title={t('home.sheet.title')} variant="open" testID="home-balance-sheet">
      {notice ? <View style={styles.sheetNotice}>{notice}</View> : null}
      <View>
        <SheetSide accountMarks={accountMarks} accountNames={accountNames} portfolioMarks={portfolioMarks} currency={currency} groups={sheet.own} locale={locale} title={t('home.sheet.own')} total={sheet.ownTotal} />
        <View style={styles.sheetSplit}>
          <SheetSide accountMarks={accountMarks} portfolioMarks={portfolioMarks} currency={currency} groups={sheet.owe} liability locale={locale} title={t('home.sheet.owe')} total={sheet.oweTotal} />
        </View>
      </View>
    </Section>
  )
}

function SheetSide({ title, groups, total, currency, locale, liability = false, accountMarks, accountNames, portfolioMarks }: {
  title: string
  groups: readonly BalanceSheetGroup[]
  total: number
  currency: string
  locale: string
  liability?: boolean
  accountMarks?: ReadonlyMap<number, EntityMarkSource>
  accountNames?: ReadonlyMap<number, string>
  portfolioMarks?: ReadonlyMap<number, EntityMarkSource>
}) {
  const formatMoney = useFormatMoney()
  const { t } = useTranslation()
  const palette = usePalette()
  const markFor = (type: BalanceSheetGroup['type'], id: number | undefined): EntityMarkSource => {
    if (type === 'portfolios') return (id !== undefined ? portfolioMarks?.get(id) : undefined) ?? portfolioMark()
    if (type === 'manualAssets') return { glyph: 'home' }
    if (type === 'loans') return { glyph: 'receipt-text' }
    return (id !== undefined ? accountMarks?.get(id) : undefined) ?? { glyph: 'landmark' }
  }
  return (
    <View>
      <Text accessibilityRole="header" style={styles.sideTitle} variant="bodyStrong">{title}</Text>
      {groups.length === 0 ? (
        <Text style={styles.sideEmpty} tone="muted" variant="meta">{t('home.sheet.sideEmpty')}</Text>
      ) : groups.map((group) => (
        <View key={group.type}>
          <Text style={styles.groupHeading} tone="muted" variant="metaStrong">{t(`home.sheet.groups.${group.type}`)}</Text>
          {group.rows.map((row) => {
            const formatted = formatMoney(row.amount, { locale, currency })
            // Already inside the account's balance: shown, never added to a total.
            const countedIn = row.countedInAccountId === undefined ? null : t('home.sheet.countedIn', { account: accountNames?.get(row.countedInAccountId) ?? '' })
            return (
              <View
                key={row.key}
                accessible
                accessibilityLabel={`${row.label}, ${formatted}, ${currency}${countedIn ? `, ${countedIn}` : ''}${liability ? `, ${t('netWorth.liabilityCue')}` : ''}`}
                style={[styles.sheetRow, { borderBottomColor: palette.border }]}
              >
                <View style={styles.sheetLabel}>
                  <EntityMark {...markFor(group.type, row.id)} size="sm" testID="balance-sheet-mark" />
                  <View style={styles.flex}>
                    <Text numberOfLines={1} variant="body">{row.label}</Text>
                    {countedIn ? <Text numberOfLines={1} tone="muted" variant="meta">{countedIn}</Text> : null}
                  </View>
                </View>
                <Amount currency={currency} locale={locale} value={row.amount} />
              </View>
            )
          })}
        </View>
      ))}
      <View style={styles.sheetTotal}>
        <Text variant="metaStrong">{t('home.sheet.total')}</Text>
        <Amount currency={currency} locale={locale} value={total} />
      </View>
    </View>
  )
}

// ── Net cash flow by month (web CashflowSection) ──────────────────────────

function CashflowSummary({ summary, currency, locale }: { summary: SavingsSummary; currency: string; locale: string }) {
  const { t } = useTranslation()
  const palette = usePalette()
  const comparison = summary.comparison
  const vs = comparison
    ? comparison.samePoint
      ? t('home.cashflow.vsSamePoint')
      : t('home.cashflow.vs', { month: formatMonthName(comparison.month, locale) })
    : null
  const change = (delta: number | null, goodWhenNegative: boolean) =>
    delta === null || vs === null ? null : (
      <View style={styles.summaryChange}>
        <Amount currency={currency} delta locale={locale} size="amountSmall" toneValue={goodWhenNegative ? -delta : delta} value={delta} />
        <Text tone="muted" variant="label">{vs}</Text>
      </View>
    )
  const rateTone = summary.savingsRateDelta === null
    ? 'muted'
    : summary.savingsRateDelta > 0
      ? 'success'
      : summary.savingsRateDelta < 0
        ? 'destructive'
        : 'muted'

  return (
    <View style={[styles.summary, { borderBottomColor: palette.border }]}>
      <Text accessibilityRole="header" variant="bodyStrong">{t('home.cashflow.thisMonth')}</Text>
      <View style={styles.summaryRow}>
        <Text tone="muted" variant="meta">{t('home.cashflow.income')}</Text>
        <View style={styles.summaryFigure}>
          <Amount currency={currency} locale={locale} size="amountLarge" value={summary.income} />
          {change(summary.incomeDelta, false)}
        </View>
      </View>
      <View style={styles.summaryRow}>
        <Text tone="muted" variant="meta">{t('home.cashflow.spending')}</Text>
        <View style={styles.summaryFigure}>
          <Amount currency={currency} locale={locale} size="amountLarge" value={summary.spending} />
          {change(summary.spendingDelta, true)}
        </View>
      </View>
      <View style={styles.summaryRow}>
        <Text tone="muted" variant="meta">{t('home.cashflow.savingsRate')}</Text>
        <View style={styles.summaryFigure}>
          <Text variant="amountLarge">{formatSavingsRate(summary.savingsRate, locale)}</Text>
          {summary.savingsRateDelta === null || vs === null ? null : (
            <View style={styles.summaryChange}>
              <Text tone={rateTone} variant="label">
                {t('home.cashflow.points', { points: formatPercentagePoints(summary.savingsRateDelta, locale) })}
              </Text>
              <Text tone="muted" variant="label">{vs}</Text>
            </View>
          )}
        </View>
      </View>
      <Text style={styles.caption} tone="muted" variant="meta">{t('home.cashflow.formula')}</Text>
    </View>
  )
}

export function CashflowSection({ state, currency, today, locale, onRetry }: {
  state: SectionState<CashflowView>
  currency: string
  today: Date
  locale: string
  onRetry: () => void
}) {
  const moneyLabel = useMoneyLabel()
  const { t } = useTranslation()
  const palette = usePalette()
  const title = t('home.cashflow.title')
  if (state.status === 'loading') return <Section title={title} variant="open"><RowsSkeleton label={title} rows={6} /></Section>
  if (state.status === 'error') return <Section title={title} variant="open"><SectionError onRetry={onRetry} /></Section>
  const { bars, zero, summary } = state.data
  if (bars.length === 0) {
    return <Section title={title} variant="open"><SectionEmpty body={t('home.cashflow.emptyBody')} title={t('home.cashflow.emptyTitle')} /></Section>
  }
  const label = (iso: string) => formatMonthName(new Date(iso), locale, { short: true, utc: true })
  const isCurrent = (iso: string) => {
    const date = new Date(iso)
    return date.getUTCFullYear() === today.getFullYear() && date.getUTCMonth() === today.getMonth()
  }
  return (
    <Section title={title} variant="open" testID="home-cashflow">
      {summary ? <CashflowSummary currency={currency} locale={locale} summary={summary} /> : null}
      <View accessibilityLabel={t('home.cashflow.listLabel', { from: label(bars[0].date), to: label(bars[bars.length - 1].date) })}>
        {bars.map((bar) => {
          const current = isCurrent(bar.date)
          const ink = bar.amount < 0 ? palette.destructiveText : palette.successText
          return (
            <View key={bar.date} accessible accessibilityLabel={`${label(bar.date)}, ${moneyLabel(bar.amount, { locale, currency })}`} style={[styles.cashRow, { borderBottomColor: palette.border }]}>
              <Text style={styles.cashMonth} tone={current ? 'default' : 'muted'} variant={current ? 'metaStrong' : 'meta'}>{label(bar.date)}</Text>
              <View style={styles.cashTrack}>
                <View style={[styles.cashZero, { left: `${zero}%`, backgroundColor: palette.mutedForeground }]} />
                <View
                  style={[
                    styles.cashBar,
                    { backgroundColor: ink, opacity: current ? 1 : 0.6, width: `${bar.width}%` },
                    bar.amount >= 0 ? { left: `${zero}%` } : { right: `${100 - zero}%` },
                  ]}
                />
              </View>
              <View style={styles.cashAmount}>
                <Amount align="right" currency={currency} delta locale={locale} value={bar.amount} />
              </View>
            </View>
          )
        })}
        <Text style={styles.caption} tone="muted" variant="meta">{t('home.cashflow.caption')}</Text>
      </View>
    </Section>
  )
}

// ── Next loan payments (web LoansSection) ─────────────────────────────────

export function LoansSection({ state, locale, onNavigate, onRetry }: {
  state: SectionState<{ upcoming: readonly LoanDto[]; hasLoans: boolean }>
  locale: string
  onNavigate: Navigate
  onRetry: () => void
}) {
  const { t } = useTranslation()
  const palette = usePalette()
  const title = t('home.loans.title')
  if (state.status === 'loading') return <Section title={title} variant="open"><RowsSkeleton label={title} rows={3} /></Section>
  if (state.status === 'error') return <Section title={title} variant="open"><SectionError onRetry={onRetry} /></Section>
  const { upcoming, hasLoans } = state.data
  if (upcoming.length === 0) {
    return (
      <Section title={title} variant="open">
        <SectionEmpty
          action={<Button label={t('home.loans.action')} onPress={() => onNavigate('/loans')} variant="secondary" />}
          body={hasLoans ? t('home.loans.noneDueBody') : t('home.loans.emptyBody')}
          title={hasLoans ? t('home.loans.noneDueTitle') : t('home.loans.emptyTitle')}
        />
      </Section>
    )
  }
  const percent = (bps: number) => {
    try {
      return new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(bps / 10_000)
    } catch {
      return `${(bps / 100).toFixed(2)}%`
    }
  }
  return (
    <Section title={title} variant="open" testID="home-loans">
      <View>
        {upcoming.map((loan) => (
          <Pressable
            key={loan.loanKey}
            accessibilityLabel={loan.name}
            accessibilityRole="link"
            onPress={() => onNavigate(`/loans/${loan.loanKey}`)}
            style={({ pressed }) => [styles.loanRow, { borderBottomColor: palette.border }, pressed && { backgroundColor: palette.muted }]}
          >
            <Text style={styles.loanDate} variant="metaStrong">{formatShortDate(calendarDay(loan.nextPaymentDate ?? ''), locale)}</Text>
            <View style={styles.loanMain}>
              <View style={styles.loanTitle}>
                <Text numberOfLines={1} style={styles.flex} variant="bodyStrong">{loan.name}</Text>
                <Amount currency={loan.currency.code} locale={locale} value={loan.regularPaymentAmount ?? null} />
              </View>
              <View style={styles.inlineFigures}>
                <Amount currency={loan.currency.code} locale={locale} size="amountSmall" value={loan.outstandingPrincipal} />
                <Text tone="muted" variant="meta">
                  {[
                    t('home.loans.left'),
                    typeof loan.annualInterestRateBps === 'number' ? t('home.loans.rate', { rate: percent(loan.annualInterestRateBps) }) : null,
                  ].filter(Boolean).join(' ')}
                  {loan.providerName ? `, ${loan.providerName}` : ''}
                </Text>
              </View>
            </View>
          </Pressable>
        ))}
      </View>
    </Section>
  )
}

// ── Latest transactions (web LatestTransactionsSection) ───────────────────

/**
 * The review inbox at a glance, above the latest transactions: how many rows are
 * waiting, what they add up to, and the way in. With nothing waiting it says so.
 * It belongs to the latest-transactions section, not to the customizable layout.
 */
function ReviewStatusRow({ review, locale, onNavigate }: {
  review: TransactionReviewSummaryDto
  locale: string
  onNavigate: Navigate
}) {
  const { t } = useTranslation()
  const palette = usePalette()
  const formatMoney = useFormatMoney()
  if (review.count === 0) {
    return (
      <View style={[styles.reviewStatus, { borderBottomColor: palette.border }]}>
        <View style={styles.reviewCaughtUp}>
          <Icon color={palette.successText} name="check" size={16} />
          <Text tone="success" variant="meta">{t('home.latest.allCaughtUp')}</Text>
        </View>
      </View>
    )
  }
  return (
    <View style={[styles.reviewStatus, { borderBottomColor: palette.border }]}>
      <Text style={styles.flex} tone="muted" variant="meta">
        {t('home.latest.reviewSummary', { amount: formatMoney(review.totalAbs, { currency: review.currency, locale }), count: review.count })}
      </Text>
      <Button label={t('home.latest.reviewNow')} onPress={() => onNavigate('/accounts/transactions?filter=unreviewed')} variant="secondary" />
    </View>
  )
}

export function LatestTransactionsSection({ state, locale, onNavigate, onRetry }: {
  state: SectionState<{ review: TransactionReviewSummaryDto | null; transactions: readonly TransactionDto[] }>
  locale: string
  onNavigate: Navigate
  onRetry: () => void
}) {
  const { t } = useTranslation()
  const palette = usePalette()
  const title = t('home.latest.title')
  if (state.status === 'loading') return <Section title={title} variant="open"><RowsSkeleton label={title} rows={6} /></Section>
  if (state.status === 'error') return <Section title={title} variant="open"><SectionError onRetry={onRetry} /></Section>
  const { review, transactions } = state.data
  if (transactions.length === 0) {
    return (
      <Section title={title} variant="open">
        <SectionEmpty
          action={<Button label={t('home.latest.action')} onPress={() => onNavigate('/accounts')} variant="secondary" />}
          body={t('home.latest.emptyBody')}
          title={t('home.latest.emptyTitle')}
        />
      </Section>
    )
  }
  // An offline account with only its opening balance has no real transaction (that row's key is
  // negative), so the review status stays out of it, exactly as for an empty account.
  const hasTransactions = transactions.some((transaction) => transaction.transactionKey > 0)
  return (
    <Section title={title} variant="open" testID="home-latest-transactions">
      <View>
        {hasTransactions && review ? <ReviewStatusRow locale={locale} onNavigate={onNavigate} review={review} /> : null}
        <List divided>
          {transactions.map((transaction) => {
            const category = transaction.appuserTransactionCategories[0]
            const fx = resolveFxState({
              fxStatus: transaction.fxStatus,
              fxRateDate: transaction.fxRateDate,
              converted: transaction.appuserSettlementAmount,
              original: transaction.editedSettlementAmount ?? transaction.settlementAmount,
              fromCurrency: transaction.settlementCurrencyKey?.code,
              toCurrency: transaction.appuserCurrencyKey?.code,
            })
            // With no exchange rate the row shows its original amount, marked "Not converted".
            const amount = fx.status === 'missing' ? fx.amount : transaction.appuserSettlementAmount ?? null
            const currency = fx.status === 'missing' ? fx.currency : transaction.appuserCurrencyKey?.code
            return (
              <ListRow
                key={transaction.transactionKey}
                density="comfortable"
                figure={<Amount currency={currency} locale={locale} size="amountBase" value={amount} />}
                leading={<EntityMark {...transactionMark({
                  synthetic: transaction.transactionKey < 0,
                  type: transaction.transactionTypeKey?.name,
                  category: category ? { name: category.icon, bgColor: category.bgColor, textColor: category.textColor } : null,
                  institutionLogoUrl: transaction.accountKey.accountFinancialInstitutionKey?.logoUrl,
                })} testID="home-transaction-mark" />}
                meta={[[formatShortDate(transactionDisplayDate(transaction.transactionDate), locale), transaction.accountKey.accountName].filter(Boolean).join(', ')]}
                title={transaction.description ?? transaction.transactionMerchantKey?.name ?? '—'}
              >
                <View style={styles.categoryLine}>
                  {category ? (
                    <Text tone="muted" variant="meta">{formatCategoryName(category.name)}</Text>
                  ) : (
                    <View style={[styles.uncategorised, { borderColor: palette.mutedForeground }]}>
                      <Text tone="muted" variant="label">{t('home.latest.uncategorised')}</Text>
                    </View>
                  )}
                  {transaction.reviewed === false ? <Text tone="warning" variant="label">{t('home.latest.needsReview')}</Text> : null}
                  <FxStatusLabel locale={locale} state={fx} testID="home-transaction-fx-status" />
                </View>
              </ListRow>
            )
          })}
        </List>
        <View style={styles.allLink}>
          <Button label={t('home.latest.all')} onPress={() => onNavigate('/accounts/transactions')} variant="link" />
        </View>
      </View>
    </Section>
  )
}

/**
 * The home's deterministic insights, in the same words and figures as web. "Spent most on" stays
 * as the fallback when no insight fires, so the section is never empty on an ordinary month.
 */
export type InsightsState =
  | { status: 'hidden' }
  | SectionState<{
      fallback: { amount: number; currency: string | null; name: string } | null
      insights: readonly InsightDto[]
    }>

export function InsightsSection({ state, fallbackCurrency, locale, onNavigate }: {
  state: InsightsState
  fallbackCurrency: string
  locale: string
  onNavigate: Navigate
}) {
  const formatMoney = useFormatMoney()
  const { t } = useTranslation()
  if (state.status === 'hidden') return null
  const title = t('netWorth.insights.title')
  if (state.status === 'loading') return <Section title={title} variant="open"><RowsSkeleton label={t('netWorth.insights.loading')} rows={2} /></Section>
  if (state.status === 'error') {
    return <Section title={title} variant="open"><Text tone="muted" variant="meta">{t('netWorth.insights.error')}</Text></Section>
  }
  const { fallback, insights } = state.data
  if (insights.length === 0) {
    if (!fallback) return null
    const amount = formatMoney(fallback.amount, { locale, currency: fallback.currency ?? fallbackCurrency })
    return (
      <Section title={title} variant="open">
        <Text variant="meta">{t('netWorth.insights.topCategory', { name: formatCategoryName(fallback.name), amount })}</Text>
      </Section>
    )
  }
  return (
    <Section title={title} variant="open" testID="home-insights">
      <View>
        {insights.map((insight) => (
          <InsightRow insight={insight} key={insight.id} locale={locale} onNavigate={onNavigate} />
        ))}
      </View>
    </Section>
  )
}

function InsightRow({ insight, locale, onNavigate }: { insight: InsightDto; locale: string; onNavigate: Navigate }) {
  const formatMoney = useFormatMoney()
  const { t } = useTranslation()
  const palette = usePalette()
  const severity = t(`netWorth.insights.severity.${insight.severity}`)
  const tone = insight.severity === 'critical' ? 'destructive' : insight.severity === 'warning' ? 'warning' : 'success'
  const rowStyle = [styles.insightRow, { borderBottomColor: palette.border }]

  if (insight.type === 'spending_vs_normal') {
    const facts = insight.facts
    const percent = Math.round(Math.abs(Number(facts.deviationPercent)))
    const money = (value: string) => formatMoney(Number(value), { locale, currency: facts.currency })
    return (
      <View style={rowStyle} testID={`home-insight-${insight.id}`}>
        <View style={styles.insightHead}>
          <Text style={styles.flex} variant="bodyStrong">
            {t(`netWorth.insights.spending.${facts.direction}`, { category: formatCategoryName(facts.categoryName), percent })}
          </Text>
          <Text tone={tone} variant="label">{severity}</Text>
        </View>
        <Text tone="muted" variant="meta">
          {t('netWorth.insights.spending.figures', { baseline: money(facts.baselineAmount), current: money(facts.currentAmount) })}
        </Text>
        <View style={styles.insightAction}>
          <Button
            label={t('netWorth.insights.spending.link')}
            onPress={() => onNavigate(spendingInsightHref(facts))}
            trailingIcon="chevron-right"
            variant="link"
          />
        </View>
      </View>
    )
  }

  const facts = insight.facts
  const category = facts.parentCategoryName ? `${facts.parentCategoryName} / ${facts.categoryName}` : facts.categoryName
  const [year, month] = insight.period.split('-')
  const money = (value: string) => formatMoney(Number(value), { locale, currency: facts.currencyCode })
  return (
    <View style={rowStyle} testID={`home-insight-${insight.id}`}>
      <View style={styles.insightHead}>
        <Text style={styles.flex} variant="bodyStrong">{t('netWorth.insights.budget.pace', { category: formatCategoryName(category) })}</Text>
        <Text tone={tone} variant="label">{severity}</Text>
      </View>
      <Text tone="muted" variant="meta">
        {t('netWorth.insights.budget.figures', { budgeted: money(facts.amountBudgeted), projected: money(facts.projectedAmount) })}
      </Text>
      <View style={styles.insightAction}>
        <Button
          label={t('netWorth.insights.budget.link')}
          onPress={() => onNavigate(`/budgets/${facts.budgetKey}/${year}/${Number(month)}`)}
          trailingIcon="chevron-right"
          variant="link"
        />
      </View>
    </View>
  )
}

/** The ledger opened on exactly the rows the card counted. */
function spendingInsightHref(facts: SpendingVsNormalFactsDto): string {
  const params = [
    `fromDate=${encodeURIComponent(facts.fromDate)}`,
    `toDate=${encodeURIComponent(facts.toDate)}`,
    `categoryKeys=${encodeURIComponent(facts.categoryKeys.join(','))}`,
  ]
  return `/accounts/transactions?${params.join('&')}`
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  skeletonRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: themeTokens.spacing[4], paddingVertical: themeTokens.spacing[3], borderBottomWidth: 1 },
  skeletonBar: { height: 16, borderRadius: themeTokens.radius.sm },
  errorBody: { gap: themeTokens.spacing[2] },
  errorAction: { marginTop: themeTokens.spacing[4], alignItems: 'flex-start' },
  empty: { alignItems: 'flex-start', gap: themeTokens.spacing[2], paddingBottom: themeTokens.spacing[6], borderBottomWidth: 1 },
  emptyAction: { marginTop: themeTokens.spacing[2] },

  setupHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: themeTokens.spacing[3] },
  setupCopy: { flex: 1, minWidth: 0, gap: 6 },
  flipped: { transform: [{ rotate: '180deg' }] },
  setupControls: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2] },
  progressTrack: { height: 6, borderRadius: themeTokens.radius.pill, overflow: 'hidden', marginTop: themeTokens.spacing[3] },
  progressFill: { height: '100%', borderRadius: themeTokens.radius.pill },
  setupSteps: { marginTop: themeTokens.spacing[4], paddingTop: themeTokens.spacing[3], borderTopWidth: 1, gap: themeTokens.spacing[1] },
  setupStep: { minHeight: themeTokens.touchTarget.minimum, flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[3], paddingHorizontal: themeTokens.spacing[2], borderRadius: themeTokens.radius.md },
  stepCircle: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, marginHorizontal: 1 },

  budgetItem: { gap: themeTokens.spacing[2], paddingVertical: themeTokens.spacing[4], borderBottomWidth: 1 },
  firstItem: { paddingTop: 0 },
  budgetHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: themeTokens.spacing[6] },
  budgetName: { flexShrink: 1, minHeight: themeTokens.touchTarget.minimum, justifyContent: 'center' },
  budgetLeft: { flexDirection: 'row', alignItems: 'baseline', gap: themeTokens.spacing[2], flexShrink: 0 },
  inlineError: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: themeTokens.spacing[4] },
  measure: { height: 10, position: 'relative', marginVertical: themeTokens.spacing[1] },
  measurePlan: { position: 'absolute', top: 0, bottom: 0, left: 0, borderRadius: 2 },
  measureFill: { position: 'absolute', top: 0, bottom: 0, left: 0, borderTopLeftRadius: 2, borderBottomLeftRadius: 2 },
  measureOver: { position: 'absolute', top: 0, bottom: 0, borderWidth: 1, opacity: 0.55, borderTopRightRadius: 2, borderBottomRightRadius: 2 },
  measureMark: { position: 'absolute', top: -4, bottom: -4, width: 2, marginLeft: -1 },
  budgetFoot: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: themeTokens.spacing[6], rowGap: themeTokens.spacing[1] },
  inlineFigures: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: themeTokens.spacing[1] },

  // The owed side starts after space, not a rule.
  sheetSplit: { marginTop: themeTokens.spacing[8] },
  sheetNotice: { marginBottom: themeTokens.spacing[6] },
  sideTitle: { fontWeight: '600', marginBottom: themeTokens.spacing[2] },
  sideEmpty: { paddingVertical: themeTokens.spacing[2] },
  groupHeading: { marginTop: themeTokens.spacing[4], marginBottom: themeTokens.spacing[1] },
  sheetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[4], paddingVertical: themeTokens.spacing[2], borderBottomWidth: 1 },
  sheetLabel: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[3] },
  sheetTotal: { flexDirection: 'row', justifyContent: 'space-between', gap: themeTokens.spacing[4], paddingTop: themeTokens.spacing[3] },

  summary: { gap: themeTokens.spacing[3], paddingBottom: themeTokens.spacing[4], marginBottom: themeTokens.spacing[4], borderBottomWidth: 1 },
  summaryRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: themeTokens.spacing[4] },
  summaryFigure: { alignItems: 'flex-end', gap: 2, flexShrink: 1 },
  summaryChange: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', justifyContent: 'flex-end', columnGap: themeTokens.spacing[1] },

  cashRow: { minHeight: themeTokens.touchTarget.minimum, flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[4], borderBottomWidth: 1 },
  cashMonth: { width: 48 },
  cashTrack: { flex: 1, height: 16, position: 'relative' },
  cashZero: { position: 'absolute', top: -10, bottom: -10, width: 1, opacity: 0.6 },
  cashBar: { position: 'absolute', top: 2, bottom: 2, borderRadius: 2 },
  cashAmount: { width: 112 },
  caption: { marginTop: themeTokens.spacing[3] },

  loanRow: { flexDirection: 'row', alignItems: 'flex-start', gap: themeTokens.spacing[4], paddingVertical: themeTokens.spacing[3], borderBottomWidth: 1 },
  loanDate: { width: 56 },
  loanMain: { flex: 1, minWidth: 0, gap: themeTokens.spacing[1] },
  loanTitle: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: themeTokens.spacing[4] },

  insightRow: { gap: themeTokens.spacing[2], paddingVertical: themeTokens.spacing[3], borderBottomWidth: 1 },
  insightHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: themeTokens.spacing[3] },
  insightAction: { alignItems: 'flex-start' },

  categoryLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: themeTokens.spacing[3], rowGap: themeTokens.spacing[1] },
  uncategorised: { borderWidth: 1, borderStyle: 'dashed', borderRadius: themeTokens.radius.sm, paddingHorizontal: 6 },
  reviewStatus: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[3], paddingBottom: themeTokens.spacing[4], marginBottom: themeTokens.spacing[4], borderBottomWidth: 1 },
  reviewCaughtUp: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2] },
  allLink: { marginTop: themeTokens.spacing[4], alignItems: 'flex-start' },
})
