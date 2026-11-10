import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { Amount } from '@/components/ui/amount'
import { Icon, type IconName } from '@/components/ui/icon'
import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import type { MetricsSummary } from './metrics-summary'

export type MetricsSectionState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'loaded'; summary: MetricsSummary | null }

/**
 * Web's `MetricsCards`, compacted for a phone: Inflow and Outflow side by side
 * at amountBase, each with the change top-right and last period's figure
 * beneath (outflow falling is the good direction), then Savings rate on one
 * row under a hairline.
 */
export function MetricsStats({ state, currency, locale, testID }: { state: MetricsSectionState; currency: string; locale: string; testID?: string }) {
  const { t } = useTranslation()
  const palette = usePalette()
  if (state.status === 'loading') {
    return (
      <View accessible accessibilityLabel={t('accountsOverview.inflow')} accessibilityRole="progressbar" style={styles.skeletons} testID={testID}>
        {[0, 1].map((index) => <View key={index} style={[styles.skeleton, { backgroundColor: palette.muted }]} />)}
      </View>
    )
  }
  if (state.status === 'error' || state.summary === null) {
    return <Text testID={testID} tone="muted" variant="meta">{t('accountsOverview.noMetrics')}</Text>
  }
  const summary = state.summary
  const vs = t('accountsOverview.vsLastPeriod')
  return (
    <View style={styles.block} testID={testID}>
      <View style={styles.columns}>
        <CompactStat
          comparison={summary.inflowPast}
          comparisonLabel={vs}
          currency={currency}
          deltaPercent={summary.inflowPct}
          icon="arrow-down-left"
          label={t('accountsOverview.inflow')}
          locale={locale}
          value={summary.inflowCurrent}
        />
        <CompactStat
          comparison={summary.outflowPast}
          comparisonLabel={vs}
          currency={currency}
          deltaPercent={summary.outflowPct}
          icon="arrow-up-right"
          label={t('accountsOverview.outflow')}
          locale={locale}
          positiveDirection="down"
          value={summary.outflowCurrent}
        />
      </View>
      <View style={[styles.savings, { borderTopColor: palette.border }]}>
        <CompactStat
          comparison={summary.netSavingsPast}
          comparisonLabel={vs}
          currency={currency}
          helper={t('accountsOverview.netSavingsRate', { rate: percent(summary.savingsRate, locale) })}
          icon="piggy-bank"
          label={t('accountsOverview.savingsRate')}
          locale={locale}
          value={summary.netSavings}
        />
      </View>
    </View>
  )
}

function CompactStat({
  label,
  icon,
  value,
  currency,
  locale,
  comparison,
  comparisonLabel,
  deltaPercent,
  positiveDirection = 'up',
  helper,
}: {
  label: string
  icon: IconName
  value: number
  currency: string
  locale: string
  comparison: number | null
  comparisonLabel: string
  deltaPercent?: number
  positiveDirection?: 'up' | 'down'
  helper?: string
}) {
  const palette = usePalette()
  const hasDelta = deltaPercent !== undefined && Number.isFinite(deltaPercent) && deltaPercent !== 0
  const rose = hasDelta && (deltaPercent as number) > 0
  const good = positiveDirection === 'up' ? rose : !rose
  return (
    <View style={styles.cell}>
      <View style={styles.labelRow}>
        <View style={styles.labelGroup}>
          <Icon color={palette.mutedForeground} name={icon} size={14} />
          <Text numberOfLines={1} style={styles.shrink} tone="muted" variant="meta">{label}</Text>
        </View>
        {hasDelta ? (
          <View style={styles.delta}>
            <Icon color={good ? palette.successText : palette.destructiveText} name={rose ? 'trending-up' : 'trending-down'} size={12} />
            <Text style={styles.deltaText} tone={good ? 'success' : 'destructive'} variant="label">
              {percent(Math.abs(deltaPercent as number), locale)}
            </Text>
          </View>
        ) : null}
      </View>
      <Amount currency={currency} locale={locale} size="amountBase" value={value} />
      {comparison !== null ? (
        <View style={styles.comparison}>
          <Amount currency={currency} locale={locale} size="amountSmall" value={comparison} />
          <Text tone="muted" variant="label">{comparisonLabel}</Text>
        </View>
      ) : null}
      {helper ? <Text tone="muted" variant="label">{helper}</Text> : null}
    </View>
  )
}

function percent(value: number, locale: string) {
  try {
    return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(value)
  } catch {
    return `${Math.round(value * 100)}%`
  }
}

const styles = StyleSheet.create({
  block: { gap: themeTokens.spacing[3] },
  columns: { flexDirection: 'row', gap: themeTokens.spacing[4] },
  savings: { borderTopWidth: 1, paddingTop: themeTokens.spacing[3] },
  cell: { flex: 1, minWidth: 0, gap: 2 },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[1] },
  labelGroup: { flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[1], flexShrink: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  delta: { flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 0 },
  deltaText: { fontWeight: '500' },
  comparison: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: themeTokens.spacing[1] },
  skeletons: { flexDirection: 'row', gap: themeTokens.spacing[4] },
  skeleton: { flex: 1, height: 56, borderRadius: themeTokens.radius.md },
})
