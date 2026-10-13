import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { BackControl } from '@/components/ui/back-control'

import { formatCurrency } from '@/lib/formatters/financial'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

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

export function DebtStrategyScreen({ state, currencyCode, onBack, onRefresh }: Props) {
  const { t, i18n } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const [tab, setTab] = useState<Strategy>('avalanche')

  if (state.status === 'access-transition') return null
  if (state.status === 'loading') return <Loading palette={palette} label={t('goals.debtStrategy.loading')} onBack={onBack} />
  if (!('data' in state)) {
    const invalid = state.status === 'invalid-response'
    return <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}><View style={styles.failure}>
      <Button label={t('goals.debtStrategy.back')} onPress={onBack} palette={palette} />
      <Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>{t(invalid ? 'goals.debtStrategy.invalidTitle' : 'goals.debtStrategy.errorTitle')}</Text>
      <Text style={[styles.body, { color: palette.mutedForeground }]}>{t(invalid ? 'goals.debtStrategy.invalidMessage' : 'goals.debtStrategy.errorMessage')}</Text>
      <Button label={t('common.retry')} onPress={onRefresh} palette={palette} primary />
    </View></SafeAreaView>
  }

  const money = (value: number) => currencyCode ? formatCurrency(value, { locale, currency: currencyCode }) : String(value)
  const { data } = state

  return <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={Boolean(state.refreshing)} onRefresh={() => void onRefresh()} tintColor={palette.primary} />}
    >
      <View style={styles.page}>
        <Button label={t('goals.debtStrategy.back')} onPress={onBack} palette={palette} />
        <View style={styles.heading}>
          <Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>{t('goals.debtStrategy.title')}</Text>
          <Text style={[styles.body, { color: palette.mutedForeground }]}>{t('goals.debtStrategy.subtitle')}</Text>
        </View>

        {state.status === 'refresh-error' ? <View style={[styles.banner, { borderColor: palette.border, backgroundColor: palette.muted }]}><Text accessibilityRole="alert" style={[styles.bannerText, { color: palette.foreground }]}>{t('goals.debtStrategy.stale')}</Text><Button label={t('common.retry')} onPress={onRefresh} palette={palette} /></View> : null}

        {!data.eligible ? (
          <View style={[styles.empty, { borderColor: palette.border }]}>
            <Text style={[styles.sectionTitle, { color: palette.foreground }]}>{t('goals.debtStrategy.ineligibleTitle')}</Text>
            <Text style={[styles.body, { color: palette.mutedForeground }]}>{t('goals.debtStrategy.ineligibleMessage')}</Text>
          </View>
        ) : (
          <>
            <View style={styles.cards}>
              <StrategyCard kind="avalanche" plan={data.avalanche} recommended={data.cheaper === 'avalanche' && data.interestSaved !== 0} money={money} t={t} palette={palette} />
              <StrategyCard kind="snowball" plan={data.snowball} recommended={data.cheaper === 'snowball' && data.interestSaved !== 0} money={money} t={t} palette={palette} />
            </View>

            {data.interestSaved > 0 ? <Text style={[styles.body, { color: palette.mutedForeground }]}>{t('goals.debtStrategy.savings', { amount: money(data.interestSaved) })}</Text> : null}

            <View accessibilityRole="tablist" style={styles.tabs}>
              <Tab label={t('goals.debtStrategy.avalanche')} selected={tab === 'avalanche'} onPress={() => setTab('avalanche')} palette={palette} />
              <Tab label={t('goals.debtStrategy.snowball')} selected={tab === 'snowball'} onPress={() => setTab('snowball')} palette={palette} />
            </View>

            <View style={[styles.chart, { borderColor: palette.border }]}>
              <Text style={[styles.sectionTitle, { color: palette.foreground }]}>{t('goals.debtStrategy.chartTitle')}</Text>
              <View style={styles.list}>
                {(tab === 'avalanche' ? data.avalanche : data.snowball).bars.map((bar) => (
                  <View key={bar.id} accessible accessibilityLabel={`${bar.name}, ${money(bar.interest)}`} style={styles.barRow}>
                    <View style={styles.barHeading}>
                      <Text style={[styles.barName, { color: palette.foreground }]}>{bar.name}</Text>
                      <Text style={[styles.barAmount, { color: palette.foreground }]}>{money(bar.interest)}</Text>
                    </View>
                    <View style={[styles.track, { backgroundColor: palette.muted }]}>
                      <View testID={`debt-strategy-bar-${bar.id}`} style={[styles.fill, { width: `${bar.widthPercent}%`, backgroundColor: palette.chart1 }]} />
                    </View>
                  </View>
                ))}
              </View>
            </View>
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

function StrategyCard({ kind, plan, recommended, money, t, palette }: { kind: Strategy; plan: DebtStrategyPlan; recommended: boolean; money: (value: number) => string; t: (key: string, values?: Record<string, unknown>) => string; palette: Palette }) {
  return <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.muted }]}>
    <View style={styles.cardHeading}>
      <Text style={[styles.sectionTitle, { color: palette.foreground }]}>{t(`goals.debtStrategy.${kind}`)}</Text>
      {recommended ? <View style={[styles.badge, { backgroundColor: palette.primarySoft }]}><Text style={[styles.badgeText, { color: palette.primary }]}>{t('goals.debtStrategy.recommended')}</Text></View> : null}
    </View>
    <Text style={[styles.caption, { color: palette.mutedForeground }]}>{t(`goals.debtStrategy.${kind}Hint`)}</Text>
    <View style={styles.cardStats}>
      <View style={styles.cardStat}><Text style={[styles.caption, { color: palette.mutedForeground }]}>{t('goals.debtStrategy.timeToPayoff')}</Text><Text style={[styles.cardStatValue, { color: palette.foreground }]}>{formatMonths(plan.months, t)}</Text></View>
      <View style={styles.cardStat}><Text style={[styles.caption, { color: palette.mutedForeground }]}>{t('goals.debtStrategy.totalInterest')}</Text><Text style={[styles.cardStatValue, { color: palette.foreground }]}>{money(plan.totalInterest)}</Text></View>
    </View>
  </View>
}

function Tab({ label, selected, onPress, palette }: { label: string; selected: boolean; onPress: () => void; palette: Palette }) {
  return <Pressable accessibilityRole="tab" accessibilityState={{ selected }} onPress={onPress} style={[styles.tab, { borderColor: selected ? palette.primary : palette.border, backgroundColor: selected ? palette.primarySoft : 'transparent' }]}>
    <Text style={[styles.tabText, { color: selected ? palette.primary : palette.mutedForeground }]}>{label}</Text>
  </Pressable>
}

function Button({ label, accessibilityLabel, onPress, palette, primary = false }: { label: string; accessibilityLabel?: string; onPress: () => void | Promise<void>; palette: Palette; primary?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} onPress={() => void onPress()} style={({ pressed }) => [styles.button, { borderColor: primary ? 'transparent' : palette.input, backgroundColor: primary ? palette.primary : 'transparent' }, pressed && styles.pressed]}>
    <Text style={[styles.buttonText, { color: primary ? palette.primaryForeground : palette.foreground }]}>{label}</Text>
  </Pressable>
}

function Loading({ palette, label, onBack }: { palette: Palette; label: string; onBack: () => void }) {
  return <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}><View style={styles.loading}><BackControl fallback="/goals" onPress={onBack} color={palette.primary} /><View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={styles.loadingBars}>{[220, 320, 300].map((width, index) => <View key={index} style={[styles.skeleton, { width, backgroundColor: palette.muted }]} />)}</View></View></SafeAreaView>
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding },
  page: { width: '100%', maxWidth: 760, alignSelf: 'center', alignItems: 'flex-start', gap: themeTokens.layout.blockGap },
  heading: { gap: themeTokens.spacing[2] },
  title: { ...textStyles.title },
  sectionTitle: { ...textStyles.section },
  body: { ...textStyles.body },
  caption: { ...textStyles.label },
  banner: { width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] }, bannerText: { ...textStyles.body },
  empty: { width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[2] },
  cards: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[3] },
  card: { flexGrow: 1, flexBasis: 260, borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[2] },
  cardHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: themeTokens.spacing[2] },
  cardStats: { flexDirection: 'row', gap: themeTokens.spacing[4], paddingTop: themeTokens.spacing[1] },
  cardStat: { gap: themeTokens.spacing[1] },
  cardStatValue: { ...textStyles.amount },
  badge: { borderRadius: themeTokens.radius.pill, paddingHorizontal: themeTokens.spacing[3], paddingVertical: themeTokens.spacing[1] },
  badgeText: { ...textStyles.label, fontWeight: '600' as const },
  tabs: { flexDirection: 'row', gap: themeTokens.spacing[2] },
  tab: { minHeight: themeTokens.touchTarget.minimum, justifyContent: 'center', borderWidth: 1, borderRadius: themeTokens.radius.pill, paddingHorizontal: themeTokens.spacing[4] },
  tabText: { ...textStyles.bodyStrong, fontWeight: '600' as const },
  chart: { width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[4] },
  list: { gap: themeTokens.spacing[4] },
  barRow: { gap: themeTokens.spacing[1] },
  barHeading: { flexDirection: 'row', justifyContent: 'space-between', gap: themeTokens.spacing[3] },
  barName: { ...textStyles.body, flex: 1 },
  barAmount: { ...textStyles.amount },
  track: { height: 4, borderRadius: themeTokens.radius.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: themeTokens.radius.pill },
  button: { minHeight: themeTokens.touchTarget.minimum, minWidth: themeTokens.touchTarget.minimum, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[4] },
  buttonText: { ...textStyles.action },
  pressed: { opacity: 0.68 },
  failure: { flex: 1, width: '100%', maxWidth: 480, alignSelf: 'center', justifyContent: 'center', alignItems: 'flex-start', padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[4] },
  loading: { flex: 1, padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[6] },
  loadingBars: { gap: themeTokens.spacing[5] },
  skeleton: { height: 24, maxWidth: '100%', borderRadius: themeTokens.radius.sm },
})
