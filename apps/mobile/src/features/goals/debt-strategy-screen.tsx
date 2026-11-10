import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native'

import { BackControl } from '@/components/ui/back-control'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Notice } from '@/components/ui/notice'
import { PageHeader } from '@/components/ui/page-header'
import { ProgressBar } from '@/components/ui/progress-bar'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Section } from '@/components/ui/section'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Text } from '@/components/ui/text'
import { useFormatMoney } from '@/lib/formatters/money-display'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import type { DebtStrategyPlan, DebtStrategyViewModel } from './debt-strategy-view-model'

export type DebtStrategyViewState =
  | { status: 'loading' | 'error' | 'invalid-response' | 'access-transition' }
  | { status: 'loaded' | 'refresh-error'; data: DebtStrategyViewModel; refreshing: boolean }

type Props = Readonly<{
  state: DebtStrategyViewState
  currencyCode: string | null
  onBack: () => void
  onRefresh: () => void | Promise<void>
}>
type Strategy = 'avalanche' | 'snowball'

/**
 * Web's `DebtStrategySection` (shown on the Goals page) as its own page: the title and what it
 * compares, Avalanche and Snowball side by side on a muted step, the saving, then the interest
 * each debt carries under the chosen order.
 */
export function DebtStrategyScreen({ state, currencyCode, onBack, onRefresh }: Props) {
  const formatMoney = useFormatMoney()
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const [tab, setTab] = useState<Strategy>('avalanche')

  if (state.status === 'access-transition') return null
  if (state.status === 'loading') return <Loading label={t('goals.debtStrategy.loading')} onBack={onBack} />
  if (!('data' in state)) {
    const invalid = state.status === 'invalid-response'
    return <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}><ScrollView contentContainerStyle={styles.content}><View style={styles.page}>
      <BackControl fallback="/goals" label={t('goals.debtStrategy.back')} onPress={onBack} />
      <Card density="standalone"><View style={styles.stack}>
        <Text accessibilityRole="header" variant="section">{t(invalid ? 'goals.debtStrategy.invalidTitle' : 'goals.debtStrategy.errorTitle')}</Text>
        <Text tone="muted" variant="meta">{t(invalid ? 'goals.debtStrategy.invalidMessage' : 'goals.debtStrategy.errorMessage')}</Text>
        <Button label={t('common.retry')} onPress={onRefresh} style={styles.hug} />
      </View></Card>
    </View></ScrollView></SafeAreaView>
  }

  const money = (value: number) => formatMoney(value, { locale, currency: currencyCode ?? null })
  const { data } = state

  return <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={Boolean(state.refreshing)} onRefresh={() => void onRefresh()} tintColor={palette.primary} />}
    >
      <View style={styles.page}>
        <View style={styles.stack}>
          <BackControl fallback="/goals" label={t('goals.debtStrategy.back')} onPress={onBack} />
          <PageHeader description={t('goals.debtStrategy.subtitle')} title={t('goals.debtStrategy.title')} />
        </View>

        {state.status === 'refresh-error' ? <Notice title={t('goals.debtStrategy.stale')} action={<Button label={t('common.retry')} onPress={onRefresh} size="sm" variant="secondary" style={styles.hug} />} /> : null}

        {!data.eligible ? (
          <Section title={t('goals.debtStrategy.ineligibleTitle')} variant="open">
            <Text tone="muted" variant="meta">{t('goals.debtStrategy.ineligibleMessage')}</Text>
          </Section>
        ) : (
          <>
            <View style={styles.cards}>
              <StrategyCard kind="avalanche" plan={data.avalanche} recommended={data.cheaper === 'avalanche' && data.interestSaved !== 0} money={money} />
              <StrategyCard kind="snowball" plan={data.snowball} recommended={data.cheaper === 'snowball' && data.interestSaved !== 0} money={money} />
            </View>

            {data.interestSaved > 0 ? <Text tone="muted" variant="meta">{t('goals.debtStrategy.savings', { amount: money(data.interestSaved) })}</Text> : null}

            <Section title={t('goals.debtStrategy.chartTitle')} variant="open">
              <SegmentedControl
                accessibilityLabel={t('goals.debtStrategy.title')}
                options={[{ value: 'avalanche', label: t('goals.debtStrategy.avalanche') }, { value: 'snowball', label: t('goals.debtStrategy.snowball') }]}
                value={tab}
                onChange={setTab}
              />
              <View style={styles.list}>
                {(tab === 'avalanche' ? data.avalanche : data.snowball).bars.map((bar) => (
                  <View key={bar.id} accessible accessibilityLabel={`${bar.name}, ${money(bar.interest)}`} style={styles.barRow}>
                    <View style={styles.barHeading}>
                      <Text style={styles.shrink} variant="metaStrong">{bar.name}</Text>
                      <Text variant="amount">{money(bar.interest)}</Text>
                    </View>
                    <ProgressBar testID={`debt-strategy-bar-${bar.id}`} track="border" value={bar.widthPercent} />
                  </View>
                ))}
              </View>
            </Section>
          </>
        )}
      </View>
    </ScrollView>
  </SafeAreaView>
}

function formatMonths(months: number, t: (key: string, values?: Record<string, unknown>) => string) {
  const years = Math.floor(months / 12)
  const remaining = months % 12
  const parts: string[] = []
  if (years > 0) parts.push(t('goals.debtStrategy.years', { count: years }))
  if (remaining > 0 || years === 0) parts.push(t('goals.debtStrategy.months', { count: remaining }))
  return parts.join(' ')
}

function StrategyCard({ kind, plan, recommended, money }: { kind: Strategy; plan: DebtStrategyPlan; recommended: boolean; money: (value: number) => string }) {
  const { t } = useTranslation()
  const palette = usePalette()
  // Web `bg-muted/40 rounded-lg p-4`: a background step, not a bordered box.
  return <View style={[styles.card, { backgroundColor: palette.muted }]}>
    <View style={styles.cardHeading}>
      <Text accessibilityRole="header" variant="bodyStrong">{t(`goals.debtStrategy.${kind}`)}</Text>
      {recommended ? <Badge label={t('goals.debtStrategy.recommended')} tone="success" /> : null}
    </View>
    <Text tone="muted" variant="meta">{t(`goals.debtStrategy.${kind}Hint`)}</Text>
    <View style={styles.cardStats}>
      <View style={styles.cardStat}><Text tone="muted" variant="label">{t('goals.debtStrategy.timeToPayoff')}</Text><Text style={styles.strong} variant="amount">{formatMonths(plan.months, t)}</Text></View>
      <View style={styles.cardStat}><Text tone="muted" variant="label">{t('goals.debtStrategy.totalInterest')}</Text><Text style={styles.strong} variant="amount">{money(plan.totalInterest)}</Text></View>
    </View>
  </View>
}

function Loading({ label, onBack }: { label: string; onBack: () => void }) {
  const { t } = useTranslation()
  const palette = usePalette()
  return <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}><View style={styles.loading}><BackControl fallback="/goals" label={t('goals.debtStrategy.back')} onPress={onBack} /><View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={styles.stack}>{[220, 320, 300].map((width, index) => <View key={index} style={[styles.skeleton, { width, backgroundColor: palette.muted }]} />)}</View></View></SafeAreaView>
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[12] },
  page: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: themeTokens.spacing[10] },
  stack: { gap: themeTokens.spacing[3] },
  hug: { alignSelf: 'flex-start' },
  shrink: { flex: 1 },
  strong: { fontWeight: '600' },
  cards: { gap: themeTokens.spacing[3] },
  card: { borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[2] },
  cardHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: themeTokens.spacing[2] },
  cardStats: { flexDirection: 'row', gap: themeTokens.spacing[4], paddingTop: themeTokens.spacing[1] },
  cardStat: { flex: 1, gap: 2 },
  list: { gap: themeTokens.spacing[4] },
  barRow: { gap: themeTokens.spacing[2] },
  barHeading: { flexDirection: 'row', justifyContent: 'space-between', gap: themeTokens.spacing[3] },
  track: { height: 8, borderRadius: themeTokens.radius.sm, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: themeTokens.radius.sm },
  loading: { flex: 1, padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[6] },
  skeleton: { height: 24, maxWidth: '100%', borderRadius: themeTokens.radius.sm },
})
