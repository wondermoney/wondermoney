import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { BackControl } from '@/components/ui/back-control'
import { Icon } from '@/components/ui/icon'
import { IconButton } from '@/components/ui/icon-button'
import { PageHeader } from '@/components/ui/page-header'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { OptionSheet } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { EntityMark } from '@/components/ui/entity-mark'
import { useFormatMoney } from '@/lib/formatters/money-display'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { measureGeometry, type BudgetCategoryViewModel } from './budgets-view-model'

export type BudgetView = 'month' | 'year'

/**
 * The budget detail head in the calm structure: back, then the budget's mark and name with its
 * icon-only help hint and one title-row glyph for the secondary actions (the linked accounts,
 * editing the details). With two of them the glyph is ⋮ and opens a menu; with one it is that
 * action's own glyph, so a single action never costs an extra tap. Under the title the `figure`
 * (what is left this month, the year's totals), then one control row: `lead` (the month
 * navigator or the year) on the left and the Month | Year segmented control on the right. The
 * app keeps its month and year routes (deep links) and the segmented control moves between them.
 */
export function BudgetDetailHeader({
  name,
  helpText,
  accountCount,
  view,
  lead,
  figure,
  onBack,
  onManageAccounts,
  onEdit,
  onChangeView,
  disabled = false,
}: {
  name: string
  helpText: string
  accountCount: number
  view: BudgetView
  /** The left of the control row: the month navigator, or the year. */
  lead?: React.ReactNode
  /** The headline figure block, between the title and the control row. */
  figure?: React.ReactNode
  onBack: () => void
  onManageAccounts?: () => void
  /** Edit the budget's details; listed with the linked accounts on the title row. */
  onEdit?: () => void
  onChangeView?: (view: BudgetView) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const accountsLabel = accountCount === 0 ? t('budgetMonth.linkAccount') : t('budgetMonth.accountsLinked', { count: accountCount })
  const actions = [
    ...(onManageAccounts ? [{ value: 'accounts' as const, label: accountsLabel, icon: 'link' as const, run: onManageAccounts }] : []),
    ...(onEdit ? [{ value: 'edit' as const, label: t('budgetMonth.edit'), icon: 'pencil' as const, run: onEdit }] : []),
  ]
  const single = actions.length === 1 ? actions[0]! : null
  const titleAction = single ? (
    <IconButton
      accessibilityLabel={single.label}
      disabled={disabled}
      icon={single.icon}
      onPress={single.run}
      style={styles.overflow}
      testID={single.value === 'accounts' ? 'budget-accounts-linked' : 'budget-edit'}
    />
  ) : actions.length > 1 ? (
    <IconButton accessibilityLabel={t('common.moreActions')} disabled={disabled} icon="more-vertical" onPress={() => setMenuOpen(true)} style={styles.overflow} testID="budget-more" />
  ) : undefined
  return (
    <View style={styles.header}>
      <View style={styles.titleBlock}>
        <BackControl disabled={disabled} fallback="/budgets" onPress={onBack} />
        <View style={styles.titleRow}>
          <EntityMark glyph="wallet-cards" />
          <View style={styles.titleMain}>
            <PageHeader action={titleAction} helpLabel={false} helpText={helpText} title={name} />
          </View>
        </View>
      </View>
      {figure}
      {lead || onChangeView ? (
        <View style={styles.controlRow}>
          <View style={styles.controlLead}>{lead}</View>
          {onChangeView ? (
            <SegmentedControl
              accessibilityLabel={t('budgetMonth.viewByLabel')}
              onChange={(next) => { if (!disabled && next !== view) onChangeView(next) }}
              options={[{ value: 'month', label: t('budgetMonth.month') }, { value: 'year', label: t('budgetMonth.year') }]}
              size="sm"
              value={view}
            />
          ) : null}
        </View>
      ) : null}
      {actions.length > 1 ? (
        <OptionSheet
          mode="menu"
          onClose={() => setMenuOpen(false)}
          onSelect={(value) => { if (!disabled) actions.find((action) => action.value === value)?.run() }}
          options={actions.map(({ value, label }) => ({ value, label }))}
          title={name}
          visible={menuOpen}
        />
      ) : null}
    </View>
  )
}

/** "‹ November 2026 ›": compact 36pt chevron buttons either side of the month. */
export function MonthNavigator({ period, range, onPrevious, onNext, previousDisabled, nextDisabled }: {
  period: string
  /** The days the month covers, under its name; absent for a calendar month. */
  range?: string | null
  onPrevious: () => void
  onNext: () => void
  previousDisabled: boolean
  nextDisabled: boolean
}) {
  const { t } = useTranslation()
  const palette = usePalette()
  const slop = (themeTokens.touchTarget.minimum - themeTokens.size.controlSmall) / 2
  const arrow = (name: 'chevron-left' | 'chevron-right', label: string, disabled: boolean, onPress: () => void) => (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={slop}
      onPress={onPress}
      style={({ pressed }) => [styles.arrow, { borderColor: palette.border }, pressed && { backgroundColor: palette.accent }, disabled && styles.disabled]}
    >
      <Icon color={palette.foreground} name={name} size={themeTokens.size.iconSmall} />
    </Pressable>
  )
  return (
    <View style={styles.navigator}>
      {arrow('chevron-left', t('budgetMonth.previousMonth'), previousDisabled, onPrevious)}
      <View accessible accessibilityLabel={range ? t('budgetMonth.periodWithRange', { period, range }) : t('budgetMonth.periodNavigation', { period })} accessibilityRole="header" style={styles.periodBlock}>
        <Text
          adjustsFontSizeToFit
          minimumFontScale={0.8}
          numberOfLines={1}
          style={styles.period}
          variant="bodyStrong"
        >
          {period}
        </Text>
        {range ? <Text numberOfLines={1} style={styles.range} tone="muted" variant="meta">{range}</Text> : null}
      </View>
      {arrow('chevron-right', t('budgetMonth.nextMonth'), nextDisabled, onNext)}
    </View>
  )
}

/**
 * Web's `Measure`: one amount against its plan on a scale shared with its neighbours. The track
 * is the plan, the fill is spending within it, a foreground tick marks where the plan ends, and
 * spending past it is drawn in the destructive ink (web hatches it; the tick and the printed
 * percentage are the non-colour cues here).
 */
export function Measure({ spent, planned, scaleMax, label, testID }: { spent: number; planned: number; scaleMax: number; label: string; testID?: string }) {
  const palette = usePalette()
  const { plan, fill, over } = measureGeometry(spent, planned, scaleMax)
  return (
    <View accessibilityLabel={label} accessibilityRole="image" accessible style={styles.measure} testID={testID}>
      <View style={[styles.measurePart, { width: `${plan}%`, backgroundColor: palette.border }]} />
      <View style={[styles.measurePart, { width: `${fill}%`, backgroundColor: palette.chart1 }]} />
      {over > 0 ? <View style={[styles.measurePart, { left: `${plan}%`, width: `${over}%`, backgroundColor: palette.destructiveText }]} testID={testID ? `${testID}-over` : undefined} /> : null}
      {plan > 0 ? <View style={[styles.tick, { left: `${plan}%`, backgroundColor: palette.foreground }]} /> : null}
    </View>
  )
}

/** Web's `MeasureKey`: what the bar's marks mean, once, under the ledger. */
export function MeasureKey() {
  const { t } = useTranslation()
  const palette = usePalette()
  return (
    <View accessibilityLabel={t('budgetMonth.keyLabel')} style={styles.key}>
      <View style={styles.keyItem}><View style={[styles.keyTick, { backgroundColor: palette.foreground }]} /><Text tone="muted" variant="label">{t('budgetMonth.keyPlan')}</Text></View>
      <View style={styles.keyItem}><View style={[styles.keySwatch, { backgroundColor: palette.chart1 }]} /><Text tone="muted" variant="label">{t('budgetMonth.keySpent')}</Text></View>
      <View style={styles.keyItem}><View style={[styles.keySwatch, { backgroundColor: palette.destructiveText }]} /><Text tone="muted" variant="label">{t('budgetMonth.keyOver')}</Text></View>
    </View>
  )
}

export const formatPercent = (value: number, locale: string) => {
  try {
    return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(value)
  } catch {
    return `${Math.round(value * 100)}%`
  }
}

/**
 * One budget line as a flat row: the category's icon and name with what remains on the right
 * (mono), a thin measure, then a muted "€0.00 of €150.00 spent" line with the share of the plan
 * at its end. Over-plan lines print the remaining and the share in the destructive ink.
 * Subcategory rows are indented under their parent; `trailing` is a row's "…" menu.
 */
export function BudgetLine({ category, view, currency, locale, scaleMax, separated = false, indented = false, extraMeta, trailing, measureTestID, children }: {
  category: BudgetCategoryViewModel
  view: BudgetView
  currency: string
  locale: string
  scaleMax: number
  separated?: boolean
  indented?: boolean
  /** Appended to the meta line, e.g. "12x per year". */
  extraMeta?: string
  trailing?: React.ReactNode
  measureTestID?: string
  children?: React.ReactNode
}) {
  const formatMoney = useFormatMoney()
  const { t } = useTranslation()
  const palette = usePalette()
  const money = (value: number) => formatMoney(value, { locale, currency })
  const progress = category.planned === 0 ? 0 : category.spent / category.planned
  const remainingLabel = t(view === 'month' ? 'budgetMonth.monthlyRemaining' : 'budgetMonth.annualRemaining')
  const tone = category.overspent ? 'destructive' : 'default'
  const meta = [t('budgetMonth.spentOfPlanned', { spent: money(category.spent), planned: money(category.planned) }), extraMeta].filter(Boolean).join(' · ')
  return (
    <View style={[styles.line, separated && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border }, indented && styles.indented]}>
      <View style={styles.lineRow}>
        <View style={styles.lineMain}>
          <View style={styles.lineHead}>
            <View style={styles.lineName}>
              <EntityMark icon={{ name: category.icon, bgColor: category.bgColor, textColor: category.textColor }} size={indented ? 'sm' : 'md'} />
              <Text numberOfLines={1} style={styles.shrink} variant={indented ? 'metaStrong' : 'bodyStrong'}>{category.name}</Text>
            </View>
            <Text accessibilityLabel={`${remainingLabel}, ${money(category.remaining)}`} numberOfLines={1} tone={tone} variant="amount">{money(category.remaining)}</Text>
          </View>
          <Measure
            label={t('budgetMonth.measureLabel', { name: category.name, spent: money(category.spent), planned: money(category.planned) })}
            planned={category.planned}
            // Each row is scaled to itself, so the bar fills the row and only an overspend
            // pushes the plan tick in from the end. A shared scale left small lines as stubs.
            scaleMax={Math.max(category.planned, category.spent) || scaleMax}
            spent={category.spent}
            testID={measureTestID}
          />
          <View style={styles.lineMeta}>
            <Text style={styles.shrink} tone="muted" variant="label">{meta}</Text>
            <Text tone={category.overspent ? 'destructive' : 'muted'} variant="amountSmall">{formatPercent(progress, locale)}</Text>
          </View>
          {view === 'month' ? <RolledOverLine category={category} money={money} testID={`budget-rollover-${category.id}`} /> : null}
        </View>
        {trailing}
      </View>
      {children}
    </View>
  )
}

/**
 * What last month carried into this line, under its plan: "+€40.00 from last month" or
 * "−€25.00 overspent last month". When the carry rests on spending that could not be converted,
 * a second line says it may be too high (read with the amount, not by a mark alone).
 */
function RolledOverLine({ category, money, testID }: { category: BudgetCategoryViewModel; money: (value: number) => string; testID?: string }) {
  const { t } = useTranslation()
  // Half a cent either way is nothing carried, as with "over plan".
  if (Math.abs(category.rolledOver) < 0.005) return null
  const overspent = category.rolledOver < 0
  const amount = money(Math.abs(category.rolledOver))
  const text = overspent ? t('budgetMonth.rolledOverOverspent', { amount }) : t('budgetMonth.rolledOverSurplus', { amount })
  const note = category.rolloverIncomplete ? t('budgetMonth.rolledOverIncomplete') : null
  return (
    <View accessibilityLabel={note ? `${text}. ${note}` : text} accessible style={styles.rollover} testID={testID}>
      <Text tone={overspent ? 'destructive' : 'muted'} variant="label">{text}</Text>
      {note ? <Text tone="muted" variant="label">{note}</Text> : null}
    </View>
  )
}

/**
 * Web's `BudgetOverviewTable` (ledger variant) at phone width: Month and Year (or Year to date
 * and Full year), each with spent, budgeted and remaining (with its share of the plan).
 */
export function BudgetOverviewTable({ rows, currency, locale }: {
  rows: readonly { name: string; spent: number; budgeted: number }[]
  currency: string
  locale: string
}) {
  const formatMoney = useFormatMoney()
  const { t } = useTranslation()
  const palette = usePalette()
  const money = (value: number) => formatMoney(value, { locale, currency })
  return (
    <View style={[styles.table, { borderTopColor: palette.border }]}>
      <View style={[styles.tableRow, { borderBottomColor: palette.border }]}>
        <Text style={styles.nameCell} tone="muted" variant="meta">{t('budgetMonth.overview')}</Text>
        <Text align="right" style={styles.numCell} tone="muted" variant="meta">{t('budgetMonth.spent')}</Text>
        <Text align="right" style={styles.numCell} tone="muted" variant="meta">{t('budgetMonth.budgeted')}</Text>
        <View style={styles.numCell}>
          <Text align="right" tone="muted" variant="meta">{t('budgetMonth.remaining')}</Text>
          <Text align="right" tone="muted" variant="label">{t('budgetMonth.inPercentage')}</Text>
        </View>
      </View>
      {rows.map((row) => {
        const remaining = row.budgeted - row.spent
        const share = row.budgeted === 0 ? null : remaining / row.budgeted
        return (
          <View
            accessibilityLabel={`${row.name}, ${t('budgetMonth.spent')} ${money(row.spent)}, ${t('budgetMonth.budgeted')} ${money(row.budgeted)}, ${t('budgetMonth.remaining')} ${money(remaining)}`}
            accessible
            key={row.name}
            style={[styles.tableRow, styles.tableBodyRow, { borderBottomColor: palette.border }]}
          >
            <Text style={[styles.nameCell, styles.semibold]} variant="meta">{row.name}</Text>
            <Text align="right" style={styles.numCell} variant="amountSmall">{money(row.spent)}</Text>
            <Text align="right" style={styles.numCell} variant="amountSmall">{money(row.budgeted)}</Text>
            <View style={styles.numCell}>
              <Text align="right" variant="amountSmall">{money(remaining)}</Text>
              {share !== null ? <Text align="right" tone="muted" variant="amountSmall">({formatPercent(share, locale)})</Text> : null}
            </View>
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  header: { gap: themeTokens.spacing[6] },
  titleBlock: { gap: themeTokens.spacing[1] },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[3] },
  titleMain: { flex: 1, minWidth: 0 },
  overflow: { marginRight: -11, marginVertical: -6 },
  controlRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[2] },
  controlLead: { flexShrink: 1, minWidth: 0 },
  navigator: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[1] },
  arrow: {
    width: themeTokens.size.controlSmall,
    height: themeTokens.size.controlSmall,
    borderRadius: themeTokens.radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  periodBlock: { flexShrink: 1 },
  period: { flexShrink: 1, textTransform: 'capitalize', paddingHorizontal: themeTokens.spacing[1] },
  range: { paddingHorizontal: themeTokens.spacing[1] },
  disabled: { opacity: 0.5 },
  measure: { height: 6, minWidth: 64, justifyContent: 'center' },
  measurePart: { position: 'absolute', top: 0, bottom: 0, left: 0, borderRadius: themeTokens.radius.sm },
  tick: { position: 'absolute', top: -3, bottom: -3, width: 2, marginLeft: -1 },
  key: { flexDirection: 'row', flexWrap: 'wrap', columnGap: themeTokens.spacing[6], rowGap: themeTokens.spacing[2] },
  keyItem: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2] },
  keyTick: { width: 2, height: 14 },
  keySwatch: { width: 16, height: 10, borderRadius: themeTokens.radius.sm },
  line: { paddingVertical: themeTokens.spacing[3], gap: themeTokens.spacing[2] },
  indented: { paddingLeft: themeTokens.spacing[6] },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2] },
  lineMain: { flex: 1, minWidth: 0, gap: 6 },
  lineHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[3] },
  lineName: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2] },
  lineMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[3] },
  shrink: { flexShrink: 1 },
  rollover: { gap: 2 },
  semibold: { fontWeight: '600' },
  table: { borderTopWidth: 1 },
  tableRow: { flexDirection: 'row', alignItems: 'flex-start', gap: themeTokens.spacing[2], paddingVertical: themeTokens.spacing[3], borderBottomWidth: 1 },
  tableBodyRow: { minHeight: 64, alignItems: 'center' },
  nameCell: { flex: 1.1 },
  numCell: { flex: 1 },
})
