import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BackHandler, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BackControl } from '@/components/ui/back-control'
import { PageHeader } from '@/components/ui/page-header'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import { PortfolioButton, PortfolioChoice, PortfolioField } from './portfolio-form-parts'
import { portfolioCreateWriteSchema, type PortfolioCreateWrite, type PortfolioCurrencyDto } from './portfolios-contract'
import type { PortfolioCreateFailure } from './use-create-portfolio'

export function PortfolioCreateScreen({ currencies, defaultCurrencyId, pending, unknownPayload, failure, detailState, confirmedPortfolioId, refreshingList, listRefreshFailed, onBack, onSubmit, onRefreshList, onRetryDetail }: {
  currencies: readonly PortfolioCurrencyDto[]; defaultCurrencyId: number | null; pending: boolean; unknownPayload: Readonly<PortfolioCreateWrite> | null; failure: PortfolioCreateFailure | null; detailState: 'idle' | 'loading' | 'unavailable'; confirmedPortfolioId: number | null; refreshingList: boolean; listRefreshFailed: boolean; onBack: () => void; onSubmit: (value: PortfolioCreateWrite) => Promise<void>; onRefreshList: () => Promise<void>; onRetryDetail: () => Promise<void>
}) {
  const { t } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const [name, setName] = useState(unknownPayload?.name ?? '')
  const [currencyId, setCurrencyId] = useState<number | null>(unknownPayload?.currencyId ?? defaultCurrencyId)
  const [reviewed, setReviewed] = useState<Readonly<PortfolioCreateWrite> | null>(unknownPayload)
  const [validation, setValidation] = useState(false)
  const unknown = unknownPayload !== null
  const effective = unknownPayload ?? reviewed

  useEffect(() => { if (!pending) return; const listener = BackHandler.addEventListener('hardwareBackPress', () => true); return () => listener.remove() }, [pending])
  const review = () => {
    const currencyExists = currencyId !== null && currencies.some((currency) => currency.currencyKey === currencyId)
    const result = portfolioCreateWriteSchema.safeParse({ name, currencyId })
    if (!currencyExists || !result.success) { setValidation(true); return }
    setValidation(false); setReviewed(Object.freeze(result.data))
  }
  const selected = currencies.find((currency) => currency.currencyKey === effective?.currencyId)
  return <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}><View style={styles.page}>
    <View style={styles.header}><BackControl fallback="/portfolio" label={t('portfolioCreate.back')} onPress={onBack} disabled={pending} /><View style={styles.heading}><PageHeader palette={palette}
            instruction={t('portfolioCreate.helper')} title={t('portfolioCreate.title')} /></View></View>
    {!effective ? <View style={styles.form}>
      <PortfolioField label={t('portfolioCreate.name')} value={name} onChange={(value) => { setName(value); setValidation(false) }} maxLength={255} palette={palette} required />
      <View style={styles.field}><Text style={[styles.label, { color: palette.foreground }]}>{t('portfolioCreate.currency')} *</Text><Text style={[styles.helper, { color: palette.mutedForeground }]}>{t('portfolioCreate.currencyHelper')}</Text><View accessibilityRole="radiogroup" accessibilityLabel={t('portfolioCreate.currency')} style={styles.options}>{currencies.map((currency) => <PortfolioChoice key={currency.currencyKey} label={`${currency.code} · ${currency.description}`} selected={currencyId === currency.currencyKey} onPress={() => { setCurrencyId(currency.currencyKey); setValidation(false) }} palette={palette} />)}</View></View>
      {validation ? <Text accessibilityRole="alert" style={[styles.alert, { color: palette.destructive }]}>{t('portfolioCreate.validation')}</Text> : null}<PortfolioButton label={t('portfolioCreate.review')} onPress={review} palette={palette} />
    </View> : <View style={styles.form}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.foreground }]}>{t('portfolioCreate.reviewTitle')}</Text><Text style={[styles.helper, { color: palette.mutedForeground }]}>{t('portfolioCreate.reviewHelper')}</Text>
      <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.card }]}><Review label={t('portfolioCreate.name')} value={effective.name} palette={palette} /><Review label={t('portfolioCreate.currency')} value={selected ? `${selected.code} · ${selected.description}` : String(effective.currencyId)} palette={palette} /></View>
      {failure && !unknown ? <Text accessibilityRole="alert" style={[styles.alert, { color: palette.destructive }]}>{t(`portfolioCreate.failures.${failure}`)}</Text> : null}
      {unknown ? <View style={[styles.notice, { borderColor: palette.destructive, backgroundColor: palette.muted }]}><Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.foreground }]}>{t('portfolioCreate.unknownTitle')}</Text><Text accessibilityRole="alert" style={[styles.helper, { color: palette.mutedForeground }]}>{t('portfolioCreate.unknownMessage')}</Text><Text style={[styles.helper, { color: palette.mutedForeground }]}>{refreshingList ? t('portfolioCreate.reconciling') : listRefreshFailed ? t('portfolioCreate.refreshFailed') : t('portfolioCreate.noInference')}</Text><View style={styles.actions}><BackControl fallback="/portfolio" label={t('portfolioCreate.back')} onPress={onBack} /><PortfolioButton label={t('portfolioCreate.refreshList')} onPress={onRefreshList} palette={palette} disabled={refreshingList} busy={refreshingList} /></View></View>
      : confirmedPortfolioId !== null ? <View style={[styles.notice, { borderColor: palette.border, backgroundColor: palette.muted }]}><Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.foreground }]}>{detailState === 'loading' ? t('portfolioCreate.confirming') : t('portfolioCreate.detailUnavailableTitle')}</Text><Text accessibilityRole={detailState === 'unavailable' ? 'alert' : undefined} style={[styles.helper, { color: palette.mutedForeground }]}>{t(detailState === 'loading' ? 'portfolioCreate.confirmingMessage' : 'portfolioCreate.detailUnavailableMessage', { id: confirmedPortfolioId })}</Text>{detailState === 'unavailable' ? <View style={styles.actions}><BackControl fallback="/portfolio" label={t('portfolioCreate.back')} onPress={onBack} /><PortfolioButton label={t('portfolioCreate.retryDetail')} onPress={onRetryDetail} palette={palette} /></View> : null}</View>
      : <View style={styles.actions}><PortfolioButton label={t('portfolioCreate.edit')} onPress={() => setReviewed(null)} palette={palette} secondary disabled={pending} /><PortfolioButton label={pending ? t('portfolioCreate.creating') : t('portfolioCreate.confirm')} onPress={() => onSubmit(effective)} palette={palette} disabled={pending} busy={pending} /></View>}
    </View>}
  </View></ScrollView></SafeAreaView>
}

function Review({ label, value, palette }: { label: string; value: string; palette: (typeof themeTokens.colors)[keyof typeof themeTokens.colors] }) { return <View accessible accessibilityLabel={`${label}: ${value}`} style={styles.review}><Text style={[styles.helper, { color: palette.mutedForeground }]}>{label}</Text><Text style={[styles.value, { color: palette.foreground }]}>{value}</Text></View> }
const styles = StyleSheet.create({ safe: { flex: 1 }, content: { flexGrow: 1, padding: themeTokens.layout.screenPadding }, page: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: themeTokens.layout.blockGap }, header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: themeTokens.spacing[4] }, heading: { flex: 1, minWidth: 220, gap: themeTokens.spacing[1] }, helper: { ...textStyles.body }, form: { gap: themeTokens.spacing[4] }, field: { gap: themeTokens.spacing[2] }, label: { ...textStyles.bodyStrong, fontWeight: '600' as const }, options: { gap: themeTokens.spacing[2] }, sectionTitle: { ...textStyles.section }, card: { borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] }, review: { gap: themeTokens.spacing[1] }, value: { ...textStyles.action }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[3] }, notice: { borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] }, alert: { ...textStyles.body } })
