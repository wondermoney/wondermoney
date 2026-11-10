import { useTranslation } from 'react-i18next'
import { ScrollView, StyleSheet, View } from 'react-native'

import { Amount } from '@/components/ui/amount'
import { BackControl } from '@/components/ui/back-control'
import { HeadlineFigure } from '@/components/ui/headline-figure'
import { List, ListRow } from '@/components/ui/list-row'
import { PageHeader } from '@/components/ui/page-header'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { EmptyState, Section } from '@/components/ui/section'
import { Stat, StatList } from '@/components/ui/stat'
import { Text } from '@/components/ui/text'
import { SelfFailure, SelfLoading, SelfStaleBanner, selfStyles } from '@/features/self/self-screen-parts'
import { formatMoneyForDisplay, useFormatMoney } from '@/lib/formatters/money-display'
import { usePrivacyMode } from '@/lib/privacy/privacy-mode'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { NetWorthChart } from './net-worth-chart'

import type { NetWorthTrendPoint, NetWorthTrendViewModel } from './net-worth-history-view-model'

export type NetWorthHistoryViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'invalid-response' }
  | { status: 'access-transition' }
  | { status: 'loaded'; data: NetWorthTrendViewModel; refreshFailed: boolean; refreshing: boolean }

export type NetWorthHistoryScreenProps = {
  state: NetWorthHistoryViewState
  onBack: () => void
  onRetry: () => void | Promise<void>
  onLogout: () => void | Promise<void>
}

export function NetWorthHistoryScreen({ state, onBack, onRetry, onLogout }: NetWorthHistoryScreenProps) {
  const { hidden } = usePrivacyMode()
  const formatMoney = useFormatMoney()
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'

  if (state.status === 'access-transition') return null
  if (state.status === 'loading') {
    return <SelfLoading label={t('netWorthHistory.loading')} backLabel={t('netWorthHistory.back')} onBack={onBack} palette={palette} />
  }
  if (state.status === 'error' || state.status === 'invalid-response') {
    const invalid = state.status === 'invalid-response'
    return (
      <SelfFailure
        title={t(invalid ? 'netWorthHistory.invalidTitle' : 'netWorthHistory.errorTitle')}
        message={t(invalid ? 'netWorthHistory.invalidMessage' : 'netWorthHistory.errorMessage')}
        backLabel={t('netWorthHistory.back')}
        retryLabel={t('common.retry')}
        signOutLabel={t('common.signOut')}
        onBack={onBack}
        onRetry={onRetry}
        onLogout={onLogout}
        palette={palette}
      />
    )
  }

  const { data } = state
  const money = (value: number | null) =>
    value === null ? t('netWorthHistory.unavailable') : formatMoney(value, { locale, currency: data.currencyCode })
  const monthLabel = (date: string) => {
    const parsed = new Date(`${date.slice(0, 10)}T00:00:00.000Z`)
    return Number.isNaN(parsed.getTime())
      ? date
      : new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(parsed)
  }
  const resolved = data.points
    .filter((point) => point.value !== null)
    .map((point) => ({ date: point.date, value: point.value as number }))
  // Newest month first, as a ledger reads.
  const rows = [...data.points].reverse()
  // The status line: the months the trend covers ("January 2026 – November 2026").
  const range = resolved.length >= 2 ? `${monthLabel(resolved[0].date)} – ${monthLabel(resolved[resolved.length - 1].date)}` : null

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={[selfStyles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.page}>
          <View style={styles.head}>
            <BackControl destination={t('navigation.home')} fallback="/" label={t('netWorthHistory.back')} onPress={onBack} />
            <PageHeader title={t('netWorthHistory.title')} helpText={t('netWorthHistory.helper')} />
          </View>
          {state.refreshFailed ? (
            <SelfStaleBanner message={t('netWorthHistory.stale')} retryLabel={t('common.retry')} refreshing={state.refreshing} onRetry={onRetry} palette={palette} />
          ) : null}

          {data.readiness === 'empty' ? (
            <EmptyState message={t('netWorthHistory.empty.message')} title={t('netWorthHistory.empty.title')} />
          ) : (
            <>
              <HeadlineFigure
                currency={data.currencyCode}
                deltas={data.stats.netChange !== null && resolved.length >= 2
                  ? [{ value: data.stats.netChange, label: t('home.netWorth.since', { month: monthLabel(resolved[0].date) }) }]
                  : undefined}
                deltaSize="amountBase"
                label={t('home.netWorth.title')}
                labelIsHeader
                locale={locale}
                status={range ? { label: range } : undefined}
                value={data.stats.latest}
              />

              {data.readiness === 'insufficient_history' ? (
                <Text accessibilityRole="alert" tone="muted" variant="meta">{t('netWorthHistory.insufficient')}</Text>
              ) : null}

              {resolved.length >= 2 ? (
                <NetWorthChart
                  accessibilityLabel={t('home.netWorth.chartLabel', { from: monthLabel(resolved[0].date), to: monthLabel(resolved[resolved.length - 1].date) })}
                  currency={data.currencyCode}
                  locale={locale}
                  points={resolved}
                />
              ) : null}

              <StatList columns={2}>
                <StatCell label={t('netWorthHistory.stats.earliest')} text={money(data.stats.earliest)} value={data.stats.earliest} currency={data.currencyCode} locale={locale} />
                <StatCell label={t('netWorthHistory.stats.latest')} text={money(data.stats.latest)} value={data.stats.latest} currency={data.currencyCode} locale={locale} />
                <StatCell label={t('netWorthHistory.stats.high')} text={money(data.stats.high)} value={data.stats.high} currency={data.currencyCode} locale={locale} />
                <StatCell label={t('netWorthHistory.stats.low')} text={money(data.stats.low)} value={data.stats.low} currency={data.currencyCode} locale={locale} />
              </StatList>
              <View
                accessible
                accessibilityLabel={`${t('netWorthHistory.stats.netChange')}, ${data.stats.netChange === null ? t('netWorthHistory.unavailable') : signedMoney(data.stats.netChange, locale, data.currencyCode, t, hidden)}`}
                style={styles.netChange}
              >
                <Text tone="muted" variant="meta">{t('netWorthHistory.stats.netChange')}</Text>
                <Amount currency={data.currencyCode} delta locale={locale} value={data.stats.netChange} />
              </View>

              <Section
                aside={t('netWorthHistory.table.value')}
                title={t('netWorthHistory.table.month')}
                variant="open"
              >
                <List divided>
                  {rows.map((point) => (
                    <TrendRow key={point.date} point={point} label={monthLabel(point.date)} money={money} locale={locale} currency={data.currencyCode} />
                  ))}
                </List>
              </Section>
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function signedMoney(value: number, locale: string, currency: string, t: (key: string, opts?: Record<string, unknown>) => string, hidden: boolean) {
  const magnitude = formatMoneyForDisplay(Math.abs(value), { locale, currency }, hidden)
  if (value > 0) return t('netWorthHistory.change.increase', { amount: magnitude })
  if (value < 0) return t('netWorthHistory.change.decrease', { amount: magnitude })
  return t('netWorthHistory.change.none')
}

function StatCell({ label, text, value, currency, locale }: { label: string; text: string; value: number | null; currency: string; locale: string }) {
  return (
    <View accessible accessibilityLabel={`${label}, ${text}`}>
      <Stat currency={currency} label={label} locale={locale} value={value} />
    </View>
  )
}

function TrendRow({ point, label, money, locale, currency }: {
  point: NetWorthTrendPoint
  label: string
  money: (value: number | null) => string
  locale: string
  currency: string
}) {
  const { hidden } = usePrivacyMode()
  const { t } = useTranslation()
  const valueText = money(point.value)
  const changeText = point.change === null ? null : signedMoney(point.change, locale, currency, t, hidden)
  const parts = [label, valueText]
  if (changeText) parts.push(changeText)
  if (!point.isComplete) parts.push(t('netWorthHistory.incomplete'))
  return (
    <ListRow
      accessibilityLabel={parts.join(', ')}
      figure={point.value === null
        ? <Text tone="muted" variant="amount">{t('netWorthHistory.unavailable')}</Text>
        : <Amount currency={currency} locale={locale} value={point.value} />}
      figureMeta={changeText ? <Text tone="muted" variant="meta">{changeText}</Text> : undefined}
      density="comfortable"
      meta={[point.isComplete ? null : t('netWorthHistory.incomplete')]}
      title={label}
    />
  )
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[12] },
  // Space, not rules, between the figure, the chart, the stats and the months.
  page: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: themeTokens.spacing[8] },
  head: { gap: themeTokens.spacing[2] },
  netChange: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: themeTokens.spacing[4], paddingVertical: themeTokens.spacing[3] },
})
