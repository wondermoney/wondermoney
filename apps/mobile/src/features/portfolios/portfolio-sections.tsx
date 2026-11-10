import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { Amount, MISSING } from '@/components/ui/amount'
import { Badge } from '@/components/ui/badge'
import { assetMark, EntityMark, portfolioMark } from '@/components/ui/entity-mark'
import { HeadlineFigure } from '@/components/ui/headline-figure'
import { Icon } from '@/components/ui/icon'
import { List, ListRow } from '@/components/ui/list-row'
import { ProgressBar } from '@/components/ui/progress-bar'
import { Section } from '@/components/ui/section'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Stat, StatList, StatValue } from '@/components/ui/stat'
import { Text } from '@/components/ui/text'
import { UnconvertedAmountsNote } from '@/components/ui/unconverted-amounts-note'
import type { AmountsCompleteness } from '@/lib/api/completeness'
import { useFormatMoney } from '@/lib/formatters/money-display'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { FeeConversionNotice } from './fee-conversion-notice'
import type { PortfolioAllocationDto, PortfolioMetricsDto, PortfolioTopMoversDto } from './portfolios-contract'
import type { HoldingViewModel, PortfolioRowViewModel } from './portfolios-view-model'
import type { PortfolioResourceState } from './use-portfolio-resource'

/**
 * The sections web's portfolio pages (`app/[locale]/(full-layout)/portfolio/page.tsx`,
 * `[portfolioId]/portfolio-client.tsx`) stack at phone width: each one an open section
 * (no rule, a 20/600 heading, space between sections), figures in Geist Mono, rows on the
 * canvas with hairlines between them. No cards around figures, no card inside a card.
 */

/** Percentage points → "20.6%" (unsigned). */
export function points(value: number, locale: string, digits = 1): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value / 100)
  } catch {
    return `${value.toFixed(digits)}%`
  }
}

/** Percentage points → "+20.6%" / "-5.1%" / "0.0%" (web `signDisplay: "exceptZero"`). */
export function signedPoints(value: number, locale: string, digits = 1): string {
  // The sign is added by hand: Hermes ignores `signDisplay` without throwing, so it would drop the "+".
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  try {
    return sign + new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(value) / 100)
  } catch {
    return `${sign}${Math.abs(value).toFixed(digits)}%`
  }
}

const trendOf = (value: number | null | undefined): 'up' | 'down' | null => (value === null || value === undefined || value === 0 ? null : value > 0 ? 'up' : 'down')

// ─── Summary ────────────────────────────────────────────────────────────────

export type SummaryFigures = Readonly<{
  currency: string
  totalValue: number
  totalGainLoss: number
  totalGainLossPercent: number
  periodLabel?: string
  periodReturn: number | null
  assetCount: number
  unrealizedGains?: number
  realizedGains?: number
  feesLeftOut?: boolean
}>

/**
 * Web's `PortfolioDashboardSummary` figures, packed for a phone: the total value leads as
 * the headline figure (small cents; `status` adds the status line, e.g. "2 Portfolios"),
 * then a two-column grid of compact cells, each with its label and direction (a trend icon,
 * plus the total gain's percentage) on one line and the figure at `amountBase` beneath.
 * Gains are signed money (`+€2,668.01`) in foreground ink. `showRealized={false}` keeps the
 * overview to its four figures.
 */
export function PortfolioSummaryStats({ figures, status, locale, showRealized = true }: { figures: SummaryFigures; status?: string; locale: string; showRealized?: boolean }) {
  const { t } = useTranslation()
  const palette = usePalette()
  const periodUnavailable = figures.periodReturn === null
  const gainShare = figures.totalGainLoss === 0 ? null : Math.sign(figures.totalGainLoss) * Math.abs(figures.totalGainLossPercent)
  const realizedShown = showRealized && figures.realizedGains !== undefined
  return (
    <View style={styles.summary} testID="portfolio-summary">
      <HeadlineFigure
        currency={figures.currency}
        label={t('portfolioSections.totalValue')}
        labelIsHeader
        locale={locale}
        status={status ? { label: status } : undefined}
        value={figures.totalValue}
      />
      <View style={styles.summaryGrid}>
        <SummaryCell delta={gainShare === null ? null : signedPoints(gainShare, locale, 0).replace(/^[+-]/, '')} label={t('portfolioSections.totalGainLoss')} trend={trendOf(gainShare)}>
          <SignedMoney currency={figures.currency} locale={locale} signed size="amountBase" value={figures.totalGainLoss} />
        </SummaryCell>
        <SummaryCell label={t('portfolioSections.periodReturn', { period: figures.periodLabel ?? 'YTD' })} trend={trendOf(figures.periodReturn)}>
          {periodUnavailable
            ? <Text numberOfLines={1} tone="muted" variant="meta">{figures.assetCount > 0 ? t('portfolioSections.needsHistory') : t('portfolioSections.noHoldings')}</Text>
            : <Text variant="amountBase">{signedPoints(figures.periodReturn as number, locale, 2)}</Text>}
        </SummaryCell>
        {figures.unrealizedGains !== undefined ? (
          <SummaryCell label={t('portfolioSections.unrealizedGains')} trend={trendOf(figures.unrealizedGains)}>
            <SignedMoney currency={figures.currency} locale={locale} signed size="amountBase" value={figures.unrealizedGains} />
          </SummaryCell>
        ) : null}
        {realizedShown ? (
          <SummaryCell label={t('portfolioSections.realizedGains')} trend={trendOf(figures.realizedGains)}>
            <SignedMoney currency={figures.currency} locale={locale} signed size="amountBase" value={figures.realizedGains as number} />
          </SummaryCell>
        ) : null}
      </View>
      {figures.feesLeftOut ? <FeeConversionNotice scope="gains" palette={palette} /> : null}
    </View>
  )
}

/** One summary figure: label and direction on one line, the figure beneath. Half the row wide. */
function SummaryCell({ label, trend = null, delta = null, children }: { label: string; trend?: 'up' | 'down' | null; delta?: string | null; children: React.ReactNode }) {
  const palette = usePalette()
  const color = trend === 'down' ? palette.destructiveText : palette.successText
  return (
    <View style={styles.summaryCell}>
      <View style={styles.summaryLabelRow}>
        <Text numberOfLines={1} style={styles.shrink} tone="muted" variant="meta">{label}</Text>
        {trend ? (
          <View style={styles.trend}>
            <Icon color={color} name={trend === 'up' ? 'trending-up' : 'trending-down'} size={14} />
            {delta ? <Text tone={trend === 'down' ? 'destructive' : 'success'} variant="label">{delta}</Text> : null}
          </View>
        ) : null}
      </View>
      {children}
    </View>
  )
}

/** A money figure at stat size; `signed` adds web's `signDisplay: "always"` plus sign. */
export function SignedMoney({ value, currency, locale, signed = false, size = 'stat' }: { value: number | null; currency: string; locale: string; signed?: boolean; size?: 'stat' | 'amountBase' | 'amount' | 'amountSmall' }) {
  if (signed && value !== null && value >= 0) {
    return (
      <View style={styles.signed}>
        <Text variant={size}>+</Text>
        <Amount currency={currency} locale={locale} size={size} value={value} />
      </View>
    )
  }
  return <Amount currency={currency} locale={locale} size={size} value={value} />
}

// ─── Section states ─────────────────────────────────────────────────────────

export function SectionStatus({ state, children }: { state: PortfolioResourceState<unknown>; children: () => React.ReactNode }) {
  const { t } = useTranslation()
  const palette = usePalette()
  if (state.status === 'loading') {
    return <View accessible accessibilityRole="progressbar" accessibilityLabel={t('portfolioSections.loading')} style={styles.placeholder}><View style={[styles.skeleton, { backgroundColor: palette.muted }]} /></View>
  }
  if (state.status === 'error') return <Text accessibilityRole="alert" tone="muted" variant="meta">{t('portfolioSections.sectionError')}</Text>
  return <>{children()}</>
}

// ─── Advanced metrics ───────────────────────────────────────────────────────

/**
 * Web's `PortfolioMetrics`: a ruled section with a muted explanation, then five figures under
 * hairlines. A figure the API withholds says why, in the body face, never as a zero.
 */
export function PortfolioMetricsSection({ state, locale }: { state: PortfolioResourceState<PortfolioMetricsDto>; locale: string }) {
  const { t } = useTranslation()
  return (
    <Section title={t('portfolioSections.advancedMetrics')} variant="open" testID="portfolio-metrics">
      <Text tone="muted" variant="meta">{t('portfolioSections.advancedMetricsDescription')}</Text>
      <SectionStatus state={state}>
        {() => {
          const metrics = (state as { data: PortfolioMetricsDto }).data.metrics
          const readiness = metrics.readiness
          const note = readiness.performance.status === 'insufficient_history'
            ? t('portfolioSections.readiness.performance')
            : readiness.riskMetrics.status === 'insufficient_history' ? t('portfolioSections.readiness.risk') : null
          const missing = (key: string) => <Text tone="muted" variant="label">{t(`portfolioSections.unavailable.${key}`)}</Text>
          const ratio = (value: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
          return (
            <>
              {note ? <Text tone="muted" variant="meta">{note}</Text> : null}
              <StatList>
                <Stat label={t('portfolioSections.annualYield')} locale={locale} valueNode={metrics.annualYield === null ? missing('annualYield') : <StatValue size="amountLarge">{signedPoints(metrics.annualYield, locale)}</StatValue>} />
                <Stat label={t('portfolioSections.volatility')} locale={locale} valueNode={metrics.volatility === null ? missing('volatility') : <StatValue size="amountLarge">{points(metrics.volatility, locale)}</StatValue>} />
                <Stat label={t('portfolioSections.sharpeRatio')} locale={locale} valueNode={metrics.sharpeRatio === null ? missing('sharpeRatio') : <StatValue size="amountLarge">{ratio(metrics.sharpeRatio)}</StatValue>} />
                <Stat label={t('portfolioSections.maxDrawdown')} locale={locale} valueNode={metrics.maxDrawdown === null ? missing('maxDrawdown') : <StatValue size="amountLarge">{points(metrics.maxDrawdown, locale)}</StatValue>} />
                <Stat label={t('portfolioSections.riskLevel')} locale={locale} valueNode={metrics.riskLevel === null ? missing('riskLevel') : <StatValue size="amountLarge" tone={metrics.riskLevel === 'Low' ? 'default' : 'warning'}>{t(`portfolioSections.riskLevels.${metrics.riskLevel}`)}</StatValue>} />
              </StatList>
            </>
          )
        }}
      </SectionStatus>
    </Section>
  )
}

// ─── Allocation ─────────────────────────────────────────────────────────────

type AllocationView = 'type' | 'sector' | 'asset'

/**
 * Web's `PortfolioAllocationChart`: By Type / By Sector / By Asset, then each slice with its
 * chart-palette swatch and percentage. Web draws a donut; here the same slices fill one
 * proportional bar (no chart library slice for a pie), slots 1→5 then muted overflow.
 */
export function PortfolioAllocationSection({ state, title, locale }: { state: PortfolioResourceState<PortfolioAllocationDto>; title?: string; locale: string }) {
  const { t } = useTranslation()
  const palette = usePalette()
  const [view, setView] = useState<AllocationView>('type')
  const body = (
    <SectionStatus state={state}>
      {() => {
        const data = (state as { data: PortfolioAllocationDto }).data
        const items = (view === 'type' ? data.byType : view === 'sector' ? data.bySector : data.byAsset) ?? []
        const priced = items.some((item) => item.percentage > 0 || item.value > 0)
        const options: { value: AllocationView; label: string }[] = [
          { value: 'type', label: t('portfolioSections.byType') },
          ...(data.bySector ? [{ value: 'sector' as const, label: t('portfolioSections.bySector') }] : []),
          ...(data.byAsset ? [{ value: 'asset' as const, label: t('portfolioSections.byAsset') }] : []),
        ]
        const ramp = [palette.chart1, palette.chart2, palette.chart3, palette.chart4, palette.chart5]
        const colorAt = (type: string, index: number) => (type === 'Unclassified' ? palette.muted : ramp[index] ?? palette.mutedForeground)
        return (
          <View style={styles.stack}>
            {options.length > 1 ? <SegmentedControl accessibilityLabel={t('portfolioSections.allocationView')} onChange={setView} options={options} value={view} /> : null}
            {!priced ? (
              <View style={styles.emptyNote}>
                <Text tone="muted" variant="meta">{t('portfolioSections.allocationEmpty')}</Text>
                <Text tone="muted" variant="label">{t('portfolioSections.allocationEmptyNote')}</Text>
              </View>
            ) : (
              <>
                <View accessible={false} style={[styles.allocationBar, { backgroundColor: palette.muted }]}>
                  {items.filter((item) => item.percentage > 0).map((item) => (
                    <View key={item.type} style={{ flex: item.percentage, backgroundColor: colorAt(item.type, items.indexOf(item)) }} />
                  ))}
                </View>
                <View style={styles.legend}>
                  {items.map((item, index) => (
                    <View accessible accessibilityLabel={t('portfolioSections.allocationShare', { label: item.type, percent: points(item.percentage, locale) })} key={item.type} style={styles.legendRow}>
                      <View style={styles.legendLabel}>
                        <View style={[styles.swatch, { backgroundColor: colorAt(item.type, index) }]} />
                        <Text numberOfLines={1} style={styles.shrink} variant="meta">{item.type}</Text>
                      </View>
                      <Text variant="amount">{points(item.percentage, locale)}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}
          </View>
        )
      }}
    </SectionStatus>
  )
  if (title === undefined) return body
  return <Section title={title} variant="open" testID="portfolio-allocation">{body}</Section>
}

// ─── Portfolio breakdown ────────────────────────────────────────────────────

/** Web's `PortfolioBreakdown` table as rows: name, value; weight and gain beneath. Rows open the portfolio. */
export function PortfolioBreakdownSection({ portfolios, locale, onSelect }: { portfolios: readonly PortfolioRowViewModel[]; locale: string; onSelect: (id: number) => void }) {
  const formatMoney = useFormatMoney()
  const { t } = useTranslation()
  return (
    <Section title={t('portfolioSections.breakdown')} variant="open">
      <List divided>
        {portfolios.map((portfolio) => {
          const value = formatMoney(portfolio.value, { locale, currency: portfolio.currency })
          const gain = signedPoints(portfolio.gainPercent, locale)
          return (
            <ListRow
              key={portfolio.id}
              testID="portfolio-row"
              accessibilityLabel={[portfolio.name, value, portfolio.weight !== undefined ? `${t('portfolioSections.weight')} ${points(portfolio.weight, locale)}` : null, `${t('portfolioSections.gain')} ${gain}`].filter(Boolean).join(', ')}
              leading={<EntityMark {...portfolioMark({ name: portfolio.brokerName })} />}
              onPress={() => onSelect(portfolio.id)}
              title={portfolio.name}
              meta={[portfolio.description]}
              figure={<Amount align="right" currency={portfolio.currency} locale={locale} value={portfolio.value} />}
              figureMeta={<Text align="right" tone={portfolio.gainPercent > 0 ? 'success' : portfolio.gainPercent < 0 ? 'destructive' : 'muted'} variant="amountSmall">{gain}</Text>}
            >
              {portfolio.weight !== undefined ? <ShareBar label={points(portfolio.weight, locale)} value={portfolio.weight} /> : null}
            </ListRow>
          )
        })}
      </List>
    </Section>
  )
}

/** Web's `<Progress>` beside a mono percentage: a violet fill on a muted track. */
export function ShareBar({ value, label }: { value: number; label: string }) {
  const palette = usePalette()
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <View style={styles.share}>
      <ProgressBar color={palette.primary} style={styles.track} value={clamped} />
      <Text variant="amountSmall">{label}</Text>
    </View>
  )
}

// ─── Top movers ─────────────────────────────────────────────────────────────

/** Web's `PortfolioTopMovers`: gainers then losers, each mover's change with its direction. */
export function PortfolioTopMoversSection({ state, currency, locale }: { state: PortfolioResourceState<PortfolioTopMoversDto>; currency: string; locale: string }) {
  const formatMoney = useFormatMoney()
  const { t } = useTranslation()
  const palette = usePalette()
  return (
    <Section title={t('portfolioSections.topMovers')} variant="open" testID="portfolio-top-movers">
      <SectionStatus state={state}>
        {() => {
          const data = (state as { data: PortfolioTopMoversDto }).data
          if (data.gainers.length === 0 && data.losers.length === 0) return <Text tone="muted" variant="meta">{t('portfolioSections.topMoversEmpty')}</Text>
          const group = (gainer: boolean) => {
            const movers = gainer ? data.gainers : data.losers
            const color = gainer ? palette.successText : palette.destructiveText
            return (
              <View style={styles.moverGroup}>
                <View style={styles.trend}>
                  <Icon color={color} name={gainer ? 'trending-up' : 'trending-down'} size={16} />
                  <Text tone={gainer ? 'success' : 'destructive'} variant="metaStrong">{t(gainer ? 'portfolioSections.gainers' : 'portfolioSections.losers')}</Text>
                </View>
                {movers.length === 0 ? <Text tone="muted" variant="meta">{t(gainer ? 'portfolioSections.noGainers' : 'portfolioSections.noLosers')}</Text> : (
                  <List divided>
                    {movers.map((mover) => (
                      <ListRow
                        key={mover.ticker}
                        accessibilityLabel={[mover.ticker, signedPoints(mover.change, locale)].join(', ')}
                        leading={<EntityMark {...assetMark(mover.ticker, mover.logoUrl)} />}
                        title={mover.ticker}
                        figure={<Text tone={gainer ? 'success' : 'destructive'} variant="amount">{signedPoints(mover.change, locale)}</Text>}
                        figureMeta={mover.contribution !== 0 ? (
                          <Text tone={gainer ? 'success' : 'destructive'} variant="amountSmall">{`${mover.contribution > 0 ? '+' : ''}${formatMoney(mover.contribution, { locale, currency })}`}</Text>
                        ) : undefined}
                      />
                    ))}
                  </List>
                )}
              </View>
            )
          }
          return <View style={styles.stack}>{group(true)}{group(false)}</View>
        }}
      </SectionStatus>
    </Section>
  )
}

// ─── Quick stats ────────────────────────────────────────────────────────────

type Performer = { change: number; ticker: string } | null | undefined

/** Web's `PortfolioQuickStats`: a two-column grid of small labelled values. */
export function PortfolioQuickStatsSection({ holdingsCount, biggestPosition, bestPerformer, worstPerformer, locale }: {
  holdingsCount: number
  biggestPosition: { ticker: string; weight: number } | null
  bestPerformer: Performer
  worstPerformer: Performer
  locale: string
}) {
  const { t } = useTranslation()
  const missing = t('portfolioSections.dataUnavailable')
  const performer = (label: string, value: Performer) => ({
    label,
    value: value?.ticker ?? missing,
    sub: value ? signedPoints(value.change, locale) : '',
    tone: !value || value.change === 0 ? 'muted' as const : value.change > 0 ? 'success' as const : 'destructive' as const,
    mono: true,
  })
  const cells = [
    { label: t('portfolioSections.holdings'), value: String(holdingsCount), sub: t('portfolioSections.assets'), tone: 'muted' as const, mono: false },
    { label: t('portfolioSections.biggestPosition'), value: biggestPosition?.ticker ?? missing, sub: biggestPosition ? points(biggestPosition.weight, locale) : '', tone: 'muted' as const, mono: true },
    performer(t('portfolioSections.bestPerformer'), bestPerformer),
    ...(worstPerformer !== undefined ? [performer(t('portfolioSections.worstPerformer'), worstPerformer)] : []),
  ]
  return (
    <Section title={t('portfolioSections.quickStats')} variant="open" testID="portfolio-quick-stats">
      <View style={styles.grid}>
        {cells.map((cell) => (
          <View accessible accessibilityLabel={[cell.label, cell.value, cell.sub].filter(Boolean).join(', ')} key={cell.label} style={styles.gridCell}>
            <Text tone="muted" variant="meta">{cell.label}</Text>
            <View style={styles.inlineValue}>
              <Text variant="bodyStrong">{cell.value}</Text>
              {cell.sub ? <Text tone={cell.tone} variant={cell.mono ? 'amountSmall' : 'label'}>{cell.sub}</Text> : null}
            </View>
          </View>
        ))}
      </View>
    </Section>
  )
}

// ─── Dividend income ────────────────────────────────────────────────────────

export type DividendIncomeData = Readonly<{ currency: string | null; dividends: readonly Readonly<{ symbol: string; value: number }>[]; totalDividends: number; completeness?: AmountsCompleteness }>

/** Whether there is anything to say about dividends: some were received, or some were left out of the total. */
export const hasDividendIncome = (data: DividendIncomeData) => data.totalDividends > 0 || data.completeness?.isComplete === false

/** Web's `PortfolioDividendIncome`: the total, then "Dividends by Asset", largest first. */
export function DividendIncomeBody({ data, locale, emptyLabel }: { data: DividendIncomeData; locale: string; emptyLabel?: string }) {
  const formatMoney = useFormatMoney()
  const { t } = useTranslation()
  if (data.totalDividends === 0 || data.dividends.length === 0) {
    return (
      <View style={styles.stack}>
        <Text tone="muted" variant="meta">{emptyLabel ?? t('portfolioSections.noDividends')}</Text>
        <UnconvertedAmountsNote completeness={data.completeness} testID="dividend-income-unconverted" />
      </View>
    )
  }
  const label = (value: number) => (data.currency ? formatMoney(value, { locale, currency: data.currency }) : t('portfolioAnalytics.valueCurrencyUnavailable', { value: formatMoney(value, { locale, currency: null, minimumFractionDigits: 0, maximumFractionDigits: 2 }) }))
  const sorted = [...data.dividends].sort((a, b) => b.value - a.value)
  return (
    <View style={styles.stack}>
      <View accessible accessibilityLabel={`${t('portfolioDetail.dividendIncome.total')}, ${label(data.totalDividends)}`} style={styles.tight}>
        <Text tone="muted" variant="meta">{t('portfolioSections.totalDividends')}</Text>
        {data.currency ? <Amount currency={data.currency} locale={locale} size="stat" value={data.totalDividends} /> : <Text variant="stat">{label(data.totalDividends)}</Text>}
      </View>
      <View style={styles.tight}>
        <Text tone="muted" variant="metaStrong">{t('portfolioSections.dividendsByAsset')}</Text>
        {sorted.map((item) => (
          <View accessible accessibilityLabel={`${item.symbol}, ${label(item.value)}`} key={item.symbol} style={styles.legendRow}>
            <Text variant="metaStrong">{item.symbol}</Text>
            {data.currency ? <Amount currency={data.currency} locale={locale} value={item.value} /> : <Text variant="amount">{label(item.value)}</Text>}
          </View>
        ))}
      </View>
      <UnconvertedAmountsNote completeness={data.completeness} testID="dividend-income-unconverted" />
    </View>
  )
}

// ─── Holdings ───────────────────────────────────────────────────────────────

/**
 * Web's `PortfolioHoldingsTable` (Type, Ticker, Allocation, … Gain/Loss) restructured as rows
 * for a phone: the asset tile and ticker lead with the type badge, the name beneath; the value
 * right with the gain or loss under it; the allocation bar under the row. Price, average cost
 * and quantity live on the holding screen the row opens.
 */
export function HoldingsList({ holdings, locale, onOpen }: { holdings: readonly HoldingViewModel[]; locale: string; onOpen: (holding: HoldingViewModel) => void }) {
  return (
    <List divided>
      {holdings.map((holding) => <HoldingRow holding={holding} key={`${holding.portfolioId ?? ''}-${holding.id}`} locale={locale} onPress={() => onOpen(holding)} />)}
    </List>
  )
}

function HoldingRow({ holding, locale, onPress }: { holding: HoldingViewModel; locale: string; onPress: () => void }) {
  const formatMoney = useFormatMoney()
  const { t } = useTranslation()
  const unavailable = t('portfolioDetail.unavailable')
  const money = (value: number | null) => (value === null ? unavailable : formatMoney(value, { locale, currency: holding.currency }))
  const signedMoney = (value: number) => `${value > 0 ? '+' : ''}${formatMoney(value, { locale, currency: holding.currency })}`
  const percent = (value: number | null) => (value === null ? null : signedPoints(value, locale))
  const gain = holding.gain === null ? null : [signedMoney(holding.gain), percent(holding.gainPercent)].filter(Boolean).join(' · ')
  const accessibilityLabel = [holding.symbol, holding.name, holding.isInvalid ? t('portfolioDetail.needsAttention') : null, holding.isInvalid ? t('portfolioDetail.invalidHolding') : null, holding.feeConversionIncomplete ? t('portfolioFees.holding') : null, `${t('portfolioDetail.currentValue')} ${money(holding.currentValue)}`, `${t('portfolioDetail.gainLoss')} ${gain ?? unavailable}`].filter(Boolean).join(', ')
  return (
    <ListRow
      testID={holding.isInvalid ? 'invalid-holding' : 'holding-row'}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      leading={<EntityMark {...assetMark(holding.symbol, holding.logoUrl)} testID="holding-mark" />}
      title={holding.symbol}
      badge={holding.isInvalid ? <Badge label={t('portfolioDetail.needsAttention')} tone="destructive" /> : holding.feeConversionIncomplete ? <Badge label={t('portfolioFees.holdingLabel')} tone="warning" /> : <Badge label={holding.type} tone="outline" />}
      meta={[holding.name, holding.isInvalid ? t('portfolioDetail.invalidHolding') : null]}
      figure={<Amount align="right" currency={holding.currency} locale={locale} value={holding.currentValue} />}
      figureMeta={<Text align="right" tone="muted" variant="amountSmall">{gain ?? MISSING}</Text>}
    >
      {holding.allocation !== null ? <ShareBar label={points(holding.allocation, locale)} value={holding.allocation} /> : null}
    </ListRow>
  )
}

// ─── Option sheet ───────────────────────────────────────────────────────────

/**
 * The picker a `SelectTrigger` opens (web's Select content, as a bottom sheet): the options as
 * rows with a check on the current one. Used for the period and for choosing a portfolio.
 */
const styles = StyleSheet.create({
  shrink: { flexShrink: 1 },
  summary: { gap: themeTokens.spacing[6] },
  // Two equal columns; cells wrap into rows of two, with no rules between them.
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: themeTokens.spacing[3] },
  summaryCell: { width: '47%', gap: 2 },
  summaryLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[2] },
  trend: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[1] },
  signed: { flexDirection: 'row', alignItems: 'baseline' },
  placeholder: { paddingVertical: themeTokens.spacing[2] },
  skeleton: { height: 96, borderRadius: themeTokens.radius.md },
  stack: { gap: themeTokens.spacing[4] },
  tight: { gap: themeTokens.spacing[2] },
  emptyNote: { gap: themeTokens.spacing[2], paddingVertical: themeTokens.spacing[6] },
  allocationBar: { height: 12, flexDirection: 'row', overflow: 'hidden', borderRadius: themeTokens.radius.sm, gap: 2 },
  legend: { gap: themeTokens.spacing[2] },
  legendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[3], minHeight: 24 },
  legendLabel: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2], flexShrink: 1 },
  swatch: { width: 12, height: 12, borderRadius: 2 },
  share: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[2], marginTop: themeTokens.spacing[1] },
  track: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  moverGroup: { gap: themeTokens.spacing[2] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: themeTokens.spacing[4], columnGap: themeTokens.spacing[4] },
  gridCell: { flexBasis: '45%', flexGrow: 1, gap: 2 },
  inlineValue: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: themeTokens.spacing[1] },
})
