import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { DateField } from '@/components/ui/date-field'
import { FormGroup, FormSelectRow } from '@/components/ui/form-row'
import { Divider } from '@/components/ui/section'
import { Icon } from '@/components/ui/icon'
import { Sheet } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { formatRange, presetFor, presetRange, RANGE_PRESETS, type RangePreset } from '@/features/transactions/transactions-date-range'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import type { PortfolioActivityRow } from './portfolio-activity-view-model'
import type { PortfolioActivityFilters } from './portfolios-contract'

export function activityCalendarFilters(from: string, to: string): PortfolioActivityFilters | null {
  const date = (value: string, end: boolean): string | undefined | null => {
    if (value === '') return undefined
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
    const suffix = end ? 'T23:59:59.999Z' : 'T00:00:00.000Z'
    const parsed = new Date(`${value}${suffix}`)
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null
    return parsed.toISOString()
  }
  const fromDate = date(from, false)
  const toDate = date(to, true)
  if (fromDate === null || toDate === null || (fromDate && toDate && fromDate > toDate)) return null
  return { ...(fromDate ? { fromDate } : {}), ...(toDate ? { toDate } : {}) }
}

/** The loaded-rows filters web's `PortfolioTransactionsTable` sheet offers (type, ticker, portfolio). */
export type PortfolioActivityRowFilters = Readonly<{ type: string | null; ticker: string | null; portfolio: string | null }>
export const NO_ROW_FILTERS: PortfolioActivityRowFilters = { type: null, ticker: null, portfolio: null }

const STOCK_SPLIT = 'STOCK_SPLIT'
const ALL = ''

/** The filter key a row answers to: its API type, or the stock-split marker. */
export const activityRowType = (row: PortfolioActivityRow) => (row.itemType === 'STOCK_SPLIT' ? STOCK_SPLIT : row.type)

export function filterActivityRows(rows: readonly PortfolioActivityRow[], filters: PortfolioActivityRowFilters): readonly PortfolioActivityRow[] {
  return rows.filter((row) => (filters.type === null || activityRowType(row) === filters.type)
    && (filters.ticker === null || row.ticker === filters.ticker)
    && (filters.portfolio === null || row.portfolioName === filters.portfolio))
}

export const activeRowFilterCount = (filters: PortfolioActivityRowFilters) => [filters.type, filters.ticker, filters.portfolio].filter((value) => value !== null).length

/**
 * Web's portfolio-transactions toolbar at phone width, the same one the account
 * ledger uses: the date-range pill ("Sep 6, 2026 – Nov 5, 2026") opening the
 * preset and custom-range sheet, then "Filters" (with its count) opening the
 * type, ticker and (on the aggregate page) portfolio filters.
 */
export function PortfolioActivityToolbar({ filters, onApply, rows, rowFilters, onRowFiltersChange, aggregate }: {
  filters: PortfolioActivityFilters
  /** `all` is the explicit "All dates" choice; the route otherwise opens on the last 60 days. */
  onApply: (filters: PortfolioActivityFilters, options?: { all?: boolean }) => void
  rows: readonly PortfolioActivityRow[]
  rowFilters: PortfolioActivityRowFilters
  onRowFiltersChange: (filters: PortfolioActivityRowFilters) => void
  aggregate: boolean
}) {
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const [rangeOpen, setRangeOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const period = presetFor(filters)
  const [from, setFrom] = useState<string | null>(period === 'custom' ? filters.fromDate?.slice(0, 10) ?? null : null)
  const [to, setTo] = useState<string | null>(period === 'custom' ? filters.toDate?.slice(0, 10) ?? null : null)
  const [invalid, setInvalid] = useState(false)
  const rangeLabel = formatRange(filters, locale) ?? t('transactions.allDates')
  const count = activeRowFilterCount(rowFilters)

  const choosePeriod = (next: RangePreset | 'all') => {
    setRangeOpen(false)
    if (next === period) return
    if (next === 'all') onApply({}, { all: true })
    else onApply(presetRange(next))
  }
  const applyCustom = () => {
    const result = from && to ? activityCalendarFilters(from, to) : null
    setInvalid(result === null)
    if (!result) return
    setRangeOpen(false)
    onApply(result)
  }

  const typeLabel = (type: string) => (type === STOCK_SPLIT
    ? t('portfolioActivity.stockSplit')
    : t(`portfolioActivity.types.${type}`, { defaultValue: rows.find((row) => row.type === type)?.typeLabel ?? type }))
  const unique = (values: readonly (string | null)[]) => [...new Set(values.filter((value): value is string => Boolean(value)))]
  const types = unique(rows.map(activityRowType))
  const tickers = unique(rows.map((row) => row.ticker)).sort((a, b) => a.localeCompare(b))
  const portfolios = aggregate ? unique(rows.map((row) => row.portfolioName)).sort((a, b) => a.localeCompare(b)) : []

  return (
    <View accessibilityLabel={t('transactions.filters')} style={styles.row}>
      <Button
        accessibilityLabel={`${t('transactions.dateRange')}, ${rangeLabel}`}
        icon="calendar"
        label={rangeLabel}
        onPress={() => setRangeOpen(true)}
        size="sm"
        style={styles.range}
        testID="portfolio-activity-range"
        variant="secondary"
      />
      <Button
        accessibilityLabel={count > 0 ? `${t('transactions.filtersTitle')}, ${t('transactions.moreFilters', { count })}` : t('transactions.filtersTitle')}
        count={count}
        countTone="secondary"
        icon="filter"
        label={t('transactions.filtersTitle')}
        onPress={() => setFiltersOpen(true)}
        size="sm"
        variant="secondary"
      />

      <Sheet closeLabel={t('transactions.close')} onClose={() => setRangeOpen(false)} title={t('transactions.dateRange')} visible={rangeOpen}>
        <View accessibilityLabel={t('transactions.dateRange')} accessibilityRole="radiogroup">
          {([...RANGE_PRESETS, 'all'] as const).map((value, index) => {
            const checked = period === value
            const label = value === 'all' ? t('transactions.allDates') : t(`transactions.last${value}Days`)
            return (
              <Pressable
                accessibilityLabel={label}
                accessibilityRole="radio"
                accessibilityState={{ checked }}
                key={String(value)}
                onPress={() => choosePeriod(value)}
                style={({ pressed }) => [styles.option, index > 0 && { borderTopWidth: 1, borderTopColor: palette.border }, pressed && { backgroundColor: palette.muted }]}
              >
                <Text style={styles.flex} tone={checked ? 'primary' : 'default'} variant={checked ? 'bodyStrong' : 'body'}>{label}</Text>
                {checked ? <Icon color={palette.primary} name="check" size={16} /> : null}
              </Pressable>
            )
          })}
        </View>
        <Divider />
        <View style={styles.sheetSection}>
          <Text accessibilityRole="header" variant="metaStrong">{t('transactions.customRange')}</Text>
          <FormGroup>
            <DateField appearance="row" label={t('portfolioActivity.fromDate')} maximumDate={to ?? undefined} onChange={setFrom} testID="portfolio-activity-from" value={from} />
            <DateField appearance="row" label={t('portfolioActivity.toDate')} minimumDate={from ?? undefined} onChange={setTo} testID="portfolio-activity-to" value={to} />
          </FormGroup>
          {invalid ? <Text accessibilityRole="alert" tone="destructive" variant="meta">{t('portfolioActivity.invalidDates')}</Text> : null}
          <Button block disabled={!from || !to} label={t('transactions.customRangeApply')} onPress={applyCustom} />
        </View>
      </Sheet>

      <Sheet
        closeLabel={t('transactions.close')}
        footer={count > 0 ? <Button block label={t('transactions.clearAll')} onPress={() => onRowFiltersChange(NO_ROW_FILTERS)} variant="outline" /> : undefined}
        onClose={() => setFiltersOpen(false)}
        title={t('transactions.filtersTitle')}
        visible={filtersOpen}
      >
        <View style={styles.sheetSection}>
          <FormGroup>
          <FormSelectRow
            label={t('portfolioActivity.filterType')}
            onChange={(type) => onRowFiltersChange({ ...rowFilters, type: type === ALL ? null : type })}
            options={[{ value: ALL, label: t('transactions.allTypes') }, ...types.map((type) => ({ value: type, label: typeLabel(type) }))]}
            placeholder={t('transactions.allTypes')}
            value={rowFilters.type ?? ALL}
          />
          <FormSelectRow
            label={t('portfolioActivity.filterTicker')}
            onChange={(ticker) => onRowFiltersChange({ ...rowFilters, ticker: ticker === ALL ? null : ticker })}
            options={[{ value: ALL, label: t('portfolioActivity.allTickers') }, ...tickers.map((ticker) => ({ value: ticker, label: ticker }))]}
            placeholder={t('portfolioActivity.allTickers')}
            value={rowFilters.ticker ?? ALL}
          />
          {aggregate ? (
            <FormSelectRow
              label={t('portfolioActivity.filterPortfolio')}
              onChange={(portfolio) => onRowFiltersChange({ ...rowFilters, portfolio: portfolio === ALL ? null : portfolio })}
              options={[{ value: ALL, label: t('portfolioActivity.allPortfolios') }, ...portfolios.map((portfolio) => ({ value: portfolio, label: portfolio }))]}
              placeholder={t('portfolioActivity.allPortfolios')}
              value={rowFilters.portfolio ?? ALL}
            />
          ) : null}
          </FormGroup>
        </View>
      </Sheet>
    </View>
  )
}

const styles = StyleSheet.create({
  // One control row that never wraps: the range on the left, Filters on the right.
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[2] },
  range: { flexShrink: 1 },
  option: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[3], minHeight: themeTokens.touchTarget.minimum, paddingVertical: themeTokens.spacing[3] },
  flex: { flex: 1 },
  sheetSection: { gap: themeTokens.spacing[3], paddingVertical: themeTokens.spacing[4] },
})
