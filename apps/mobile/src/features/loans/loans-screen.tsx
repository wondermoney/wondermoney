import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { BackControl } from '@/components/ui/back-control'
import { PreviewLabel } from '@/components/ui/preview-label'
import { formatCurrency } from '@/lib/formatters/financial'
import { themeTokens, type Palette } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import type { LoanViewModel } from './loans-view-model'

export type LoansViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'invalid-response' }
  | { status: 'access-transition' }
  | { status: 'loaded'; loans: readonly LoanViewModel[]; refreshing?: boolean }
  | { status: 'refresh-error'; loans: readonly LoanViewModel[]; refreshing?: boolean }


export function LoansScreen({ state, onOpenLoan, onRefresh, onBack, onCreateLoan }: {
  state: LoansViewState
  onOpenLoan: (loanId: number) => void
  onRefresh: () => void | Promise<void>
  onBack: () => void
  onCreateLoan: () => void
}) {
  const { t, i18n } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  if (state.status === 'access-transition') return null
  if (state.status === 'loading') return <Loading label={t('loans.loading')} palette={palette} />
  if (state.status === 'error' || state.status === 'invalid-response') return <Failure title={t(state.status === 'invalid-response' ? 'loans.invalidTitle' : 'loans.errorTitle')} message={t(state.status === 'invalid-response' ? 'loans.invalidMessage' : 'loans.errorMessage')} onRetry={onRefresh} onBack={onBack} backLabel={t('loans.back')} palette={palette} />
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={Boolean(state.refreshing)} onRefresh={() => void onRefresh()} tintColor={palette.primary} />}>
        <View style={styles.page}>
          <Header title={t('loans.title')} helper={t('loans.helper')} backLabel={t('loans.back')} onBack={onBack} palette={palette} />
          {state.status === 'refresh-error' ? <Alert label={t('loans.stale')} palette={palette} /> : null}
          <Button label={t('loans.add')} onPress={onCreateLoan} palette={palette} variant="primary" />
          {state.loans.length === 0 ? (
            <View style={[styles.empty, { borderColor: palette.border, backgroundColor: palette.card }]}>
              <View style={[styles.marker, { backgroundColor: palette.mutedForeground }]} />
              <Text accessibilityRole="header" allowFontScaling style={[styles.emptyTitle, { color: palette.foreground }]}>{t('loans.emptyTitle')}</Text>
              <Text allowFontScaling style={[styles.body, { color: palette.mutedForeground }]}>{t('loans.emptyMessage')}</Text>
              <LoanPreview locale={locale} palette={palette} />
            </View>
          ) : <View style={styles.list}>{state.loans.map((loan) => <LoanCard key={loan.id} loan={loan} locale={locale} onPress={() => onOpenLoan(loan.id)} palette={palette} />)}</View>}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function LoanCard({ loan, locale, onPress, palette }: { loan: LoanViewModel; locale: string; onPress: () => void; palette: Palette }) {
  const { t } = useTranslation()
  const [focused, setFocused] = useState(false)
  const money = (value: number) => formatCurrency(value, { locale, currency: loan.currencyCode })
  const payment = loan.regularPayment === null ? t('loans.paymentUnavailable') : t('loans.paymentValue', { value: money(loan.regularPayment), frequency: t(`loans.frequency.${loan.paymentFrequency}`) })
  const next = loan.nextPaymentDate ? formatDate(loan.nextPaymentDate, locale) : null
  const label = [loan.name, t(`loans.type.${loan.type}`), t(`loans.status.${loan.status}`), `${t('loans.outstanding')}, ${money(loan.outstanding)}, ${loan.currencyCode}`, payment, next ? t('loans.nextPaymentValue', { date: next }) : null].filter(Boolean).join(', ')
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onBlur={() => setFocused(false)} onFocus={() => setFocused(true)} onPress={onPress} style={({ pressed }) => [styles.card, { borderColor: palette.border, backgroundColor: palette.card }, focused && { borderWidth: 2, borderColor: palette.foreground }, pressed && styles.pressed]}>
      <View style={styles.cardTop}><View style={styles.cardHeading}><Text allowFontScaling style={[styles.cardName, { color: palette.foreground }]}>{loan.name}</Text><Text allowFontScaling style={[styles.meta, { color: palette.mutedForeground }]}>{t(`loans.type.${loan.type}`)} · {t(`loans.status.${loan.status}`)}</Text></View><Text accessible={false} style={[styles.arrow, { color: palette.primary }]}>›</Text></View>
      <View style={styles.hero}><Text allowFontScaling style={[styles.label, { color: palette.mutedForeground }]}>{t('loans.outstanding')}</Text><Text allowFontScaling style={[styles.amount, { color: palette.foreground }]}>{money(loan.outstanding)}</Text><Text allowFontScaling style={[styles.currency, { color: palette.mutedForeground }]}>{loan.currencyCode}</Text></View>
      <View style={[styles.payment, { borderTopColor: palette.border }]}><Text allowFontScaling style={[styles.paymentText, { color: palette.foreground }]}>{payment}</Text>{next ? <Text allowFontScaling style={[styles.meta, { color: palette.mutedForeground }]}>{t('loans.nextPaymentValue', { date: next })}</Text> : loan.paymentDay ? <Text allowFontScaling style={[styles.meta, { color: palette.mutedForeground }]}>{t('loans.paymentDayValue', { day: loan.paymentDay })}</Text> : null}</View>
    </Pressable>
  )
}

/**
 * Matches web/'s Loans preview content (Mortgage / Bank / Active, Outstanding
 * principal, Remaining term) — mobile shipped this empty state with no
 * preview at all, unlike every other screen's data-forward pattern. See
 * DESIGN_HISTORY.md's Known Cross-Platform Gaps.
 */
function LoanPreview({ locale, palette }: { locale: string; palette: Palette }) {
  const { t } = useTranslation()
  const money = (value: number) => formatCurrency(value, { locale, currency: 'EUR' })
  return (
    <View style={[styles.loanPreview, { backgroundColor: palette.muted }]}>
      <View style={styles.previewHeading}>
        <PreviewLabel />
        <Text allowFontScaling style={[styles.meta, { color: palette.mutedForeground }]}>{t('loans.previewSubtitle')}</Text>
      </View>
      <View style={styles.previewTop}>
        <View style={styles.cardHeading}>
          <Text allowFontScaling style={[styles.cardName, { color: palette.foreground }]}>{t('loans.type.MORTGAGE')}</Text>
          <Text allowFontScaling style={[styles.meta, { color: palette.mutedForeground }]}>{t('loans.previewProvider')}</Text>
        </View>
        <Text allowFontScaling style={[styles.meta, { color: palette.mutedForeground }]}>{t('loans.status.ACTIVE')}</Text>
      </View>
      <View style={styles.previewMetrics}>
        <View style={styles.previewMetric}>
          <Text allowFontScaling style={[styles.label, { color: palette.mutedForeground }]}>{t('loans.outstanding')}</Text>
          <Text allowFontScaling style={[styles.previewValue, { color: palette.foreground }]}>{money(0)}</Text>
        </View>
        <View style={styles.previewMetric}>
          <Text allowFontScaling style={[styles.label, { color: palette.mutedForeground }]}>{t('loans.remainingTerm')}</Text>
          <Text allowFontScaling style={[styles.previewValue, { color: palette.foreground }]}>{t('loans.previewTermValue')}</Text>
        </View>
      </View>
    </View>
  )
}

export function formatDate(value: string, locale: string): string {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value)
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(parsed)
}

export function Header({ title, helper, backLabel, onBack, palette }: { title: string; helper: string; backLabel: string; onBack: () => void; palette: Palette }) {
  return <View style={styles.header}><BackControl fallback="/more" onPress={onBack} color={palette.primary} /><PageHeader palette={palette} title={title} /></View>
}

export function Alert({ label, palette }: { label: string; palette: Palette }) {
  return <Text accessible accessibilityRole="alert" accessibilityLabel={label} allowFontScaling style={[styles.alert, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.muted }]}>{label}</Text>
}

export function Loading({ label, palette }: { label: string; palette: Palette }) {
  return <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}><View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={styles.loading}>{[160, 240, 240].map((width, index) => <View key={index} style={[styles.skeleton, { width, maxWidth: '100%', backgroundColor: palette.muted }]} />)}</View></SafeAreaView>
}

export function Failure({ title, message, onRetry, onBack, backLabel, palette }: { title: string; message: string; onRetry?: () => void | Promise<void>; onBack: () => void; backLabel: string; palette: Palette }) {
  const { t } = useTranslation()
  return <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}><View style={styles.failure}><View style={[styles.failureMarker, { backgroundColor: palette.destructive }]} /><Text accessibilityRole="header" allowFontScaling style={[styles.failureTitle, { color: palette.foreground }]}>{title}</Text><Text allowFontScaling style={[styles.body, { color: palette.mutedForeground }]}>{message}</Text><View style={styles.actions}>{onRetry ? <Button label={t('common.retry')} onPress={onRetry} palette={palette} variant="primary" /> : null}<Button label={backLabel} onPress={onBack} palette={palette} variant="secondary" /></View></View></SafeAreaView>
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 }, content: { flexGrow: 1, padding: themeTokens.layout.screenPadding }, page: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: themeTokens.layout.blockGap }, header: { gap: themeTokens.spacing[4] }, back: { minHeight: themeTokens.touchTarget.minimum, alignSelf: 'flex-start', justifyContent: 'center' }, backText: { ...textStyles.action }, list: { gap: themeTokens.spacing[4] },
  card: { borderWidth: 1, borderRadius: themeTokens.radius.xl, padding: themeTokens.spacing[5], gap: themeTokens.spacing[4] }, cardTop: { flexDirection: 'row', justifyContent: 'space-between', gap: themeTokens.spacing[4] }, cardHeading: { flex: 1, gap: themeTokens.spacing[1] }, cardName: { ...textStyles.section }, meta: { ...textStyles.meta }, arrow: { ...textStyles.title, fontWeight: '400' as const }, hero: { gap: themeTokens.spacing[1] }, label: { ...textStyles.label, fontWeight: '600' as const }, amount: { ...textStyles.display }, currency: { ...textStyles.amountSmall }, payment: { borderTopWidth: 1, paddingTop: themeTokens.spacing[3], gap: themeTokens.spacing[1] }, paymentText: { ...textStyles.body }, empty: { borderWidth: 1, borderRadius: themeTokens.radius.xl, padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[3] }, marker: { width: 40, height: 3, borderRadius: themeTokens.radius.pill }, emptyTitle: { ...textStyles.section }, body: { ...textStyles.body }, alert: { ...textStyles.body, borderWidth: 1, borderRadius: themeTokens.radius.md, padding: themeTokens.spacing[4] },
  loading: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center', padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[5] }, skeleton: { height: 72, borderRadius: themeTokens.radius.lg }, failure: { flex: 1, width: '100%', maxWidth: 520, alignSelf: 'center', justifyContent: 'center', padding: themeTokens.layout.screenPadding, gap: themeTokens.spacing[4] }, failureMarker: { width: 42, height: 3 }, failureTitle: { ...textStyles.title }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[3] }, pressed: { opacity: 0.68 },
  // Background-step, not a second border nested inside `empty`'s own border
  // (No-Nesting rule).
  loanPreview: { borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] }, previewHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, previewTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: themeTokens.spacing[3] }, previewMetrics: { flexDirection: 'row', gap: themeTokens.spacing[5] }, previewMetric: { flex: 1, gap: themeTokens.spacing[1] }, previewValue: { ...textStyles.amount },
})
