import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { FlatList, StyleSheet, View } from 'react-native'
import type { ListRenderItemInfo } from 'react-native'

import { BackControl } from '@/components/ui/back-control'
import { Button } from '@/components/ui/button'
import { assetMark, EntityMark } from '@/components/ui/entity-mark'
import { FormGroup, FormSwitchRow, FormTextRow } from '@/components/ui/form-row'
import { ListRow } from '@/components/ui/list-row'
import { PageHeader } from '@/components/ui/page-header'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Text } from '@/components/ui/text'
import { parseNumberInput } from '@/lib/formatters/decimal-input'
import { useHideMoneyText } from '@/lib/formatters/money-display'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { AVAILABLE_COUNTRIES, AVAILABLE_EXCHANGES, AVAILABLE_INDUSTRIES, AVAILABLE_SECTORS } from './screener-canonical-lists'
import { CanonicalValuePicker } from './canonical-value-picker'
import { MarketsFailure, marketsStyles } from './markets-screen-parts'
import { formatScreenerMarketCap, formatScreenerPrice, type ScreenerRow } from './markets-view-model'

export type ScreenerFilterFormValues = Readonly<{
  isEtf: boolean
  isActivelyTrading: boolean
  priceMoreThan: string
  priceLowerThan: string
  marketCapMoreThan: string
  marketCapLowerThan: string
  sector: string | null
  industry: string | null
  country: string | null
  exchange: string | null
}>

export type ScreenerScreenState =
  | { status: 'access-transition' }
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'invalid-response' }
  | { status: 'error' }
  | { status: 'empty' }
  | {
    status: 'loaded'
    rows: readonly ScreenerRow[]
    hasMore: boolean
    loadingMore: boolean
    loadMoreError: boolean
  }

/** The typed price and market-cap bounds, read in the app's language; blank is no bound. */
export type ScreenerNumberFilters = Readonly<{
  priceMoreThan: number | undefined
  priceLowerThan: number | undefined
  marketCapMoreThan: number | undefined
  marketCapLowerThan: number | undefined
}>

const NUMBER_FIELDS = ['priceMoreThan', 'priceLowerThan', 'marketCapMoreThan', 'marketCapLowerThan'] as const

export type ScreenerScreenProps = {
  state: ScreenerScreenState
  form: ScreenerFilterFormValues
  onFormChange: (patch: Partial<ScreenerFilterFormValues>) => void
  onApplyFilters: (numbers: ScreenerNumberFilters) => void
  onLoadMore: () => void
  onSelectSymbol: (symbol: string) => void
  onBack: () => void
}

/**
 * The filters are two groups of form rows (the switches and the price and
 * market-cap bounds, then the four canonical lists) that stage changes via
 * onFormChange (no request fires per keystroke); only the "Apply filters"
 * action fetches. Below them, the results are flat rows, paginated: a "Load more" action
 * appears whenever `hasMore` is true, mirroring goal-detail-screen's
 * load-more convention (loadingMore disables it, loadMoreError shows a
 * scoped note beside the list rather than replacing it with a full error).
 */
export function ScreenerScreen({ state, form, onFormChange, onApplyFilters, onLoadMore, onSelectSymbol, onBack }: ScreenerScreenProps) {
  const { t, i18n } = useTranslation()
  const palette = usePalette()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  // "1.000" is a thousand in pt and es and one in en; anything unreadable blocks the search.
  const parsedBounds = Object.fromEntries(NUMBER_FIELDS.map((field) => [field, form[field].trim() === '' ? undefined : parseNumberInput(form[field], locale)])) as Record<(typeof NUMBER_FIELDS)[number], number | null | undefined>
  const invalidBound = (field: (typeof NUMBER_FIELDS)[number]) => parsedBounds[field] === null
  const boundsValid = NUMBER_FIELDS.every((field) => !invalidBound(field))
  const boundError = (field: (typeof NUMBER_FIELDS)[number]) => (invalidBound(field) ? t('screener.numberInvalid') : null)
  const apply = () => {
    if (!boundsValid) return
    onApplyFilters(Object.fromEntries(NUMBER_FIELDS.map((field) => [field, parsedBounds[field] ?? undefined])) as ScreenerNumberFilters)
  }

  if (state.status === 'access-transition') return null

  if (state.status === 'error' || state.status === 'invalid-response') {
    const invalid = state.status === 'invalid-response'
    return (
      <MarketsFailure
        title={t(invalid ? 'screener.invalidResponse.title' : 'screener.error.title')}
        message={t(invalid ? 'screener.invalidResponse.message' : 'screener.error.message')}
        backLabel={t('screener.back')}
        retryLabel={t('common.retry')}
        onBack={onBack}
        onRetry={apply}
        palette={palette}
      />
    )
  }

  const any = t('screener.canonicalPicker.any')
  const priceUnavailable = t('screener.priceUnavailable')
  const marketCapUnavailable = t('screener.marketCapUnavailable')
  const rows = state.status === 'loaded' ? state.rows : []
  const renderRow = ({ item, index }: ListRenderItemInfo<ScreenerRow>) => (
    <ScreenerRowView
      row={item}
      locale={locale}
      separated={index > 0}
      onPress={() => onSelectSymbol(item.symbol)}
      priceUnavailable={priceUnavailable}
      marketCapUnavailable={marketCapUnavailable}
    />
  )

  const header = (
    <View style={headingStyles.headerGroup}>
      <BackControl destination={t('navigation.explorer')} fallback="/markets" label={t('screener.back')} onPress={onBack} />

      <PageHeader helpText={t('screener.helper')} title={t('screener.title')} />

      {/* The filters as one group of rows, staged until "Apply filters". */}
      <View style={headingStyles.filters}>
        <FormGroup>
          <FormSwitchRow label={t('screener.isEtfLabel')} value={form.isEtf} onValueChange={(value) => onFormChange({ isEtf: value })} />
          <FormSwitchRow label={t('screener.isActivelyTradingLabel')} value={form.isActivelyTrading} onValueChange={(value) => onFormChange({ isActivelyTrading: value })} />
          <FormTextRow autoCapitalize="none" autoCorrect={false} error={boundError('priceMoreThan')} keyboardType="decimal-pad" label={t('screener.priceMoreThanLabel')} onChangeText={(value) => onFormChange({ priceMoreThan: value })} placeholder={any} value={form.priceMoreThan} />
          <FormTextRow autoCapitalize="none" autoCorrect={false} error={boundError('priceLowerThan')} keyboardType="decimal-pad" label={t('screener.priceLowerThanLabel')} onChangeText={(value) => onFormChange({ priceLowerThan: value })} placeholder={any} value={form.priceLowerThan} />
          <FormTextRow autoCapitalize="none" autoCorrect={false} error={boundError('marketCapMoreThan')} keyboardType="decimal-pad" label={t('screener.marketCapMoreThanLabel')} onChangeText={(value) => onFormChange({ marketCapMoreThan: value })} placeholder={any} value={form.marketCapMoreThan} />
          <FormTextRow autoCapitalize="none" autoCorrect={false} error={boundError('marketCapLowerThan')} keyboardType="decimal-pad" label={t('screener.marketCapLowerThanLabel')} onChangeText={(value) => onFormChange({ marketCapLowerThan: value })} placeholder={any} value={form.marketCapLowerThan} />
        </FormGroup>
        <FormGroup>
          <CanonicalValuePicker label={t('screener.sectorLabel')} options={AVAILABLE_SECTORS} selected={form.sector} onSelect={(value) => onFormChange({ sector: value })} />
          <CanonicalValuePicker label={t('screener.industryLabel')} options={AVAILABLE_INDUSTRIES} selected={form.industry} onSelect={(value) => onFormChange({ industry: value })} />
          <CanonicalValuePicker label={t('screener.countryLabel')} options={AVAILABLE_COUNTRIES} selected={form.country} onSelect={(value) => onFormChange({ country: value })} />
          <CanonicalValuePicker label={t('screener.exchangeLabel')} options={AVAILABLE_EXCHANGES} selected={form.exchange} onSelect={(value) => onFormChange({ exchange: value })} />
        </FormGroup>
        <Button block disabled={!boundsValid} label={t('screener.apply')} onPress={apply} variant="primary" />
      </View>

      {state.status === 'loading' ? (
        <View accessible accessibilityRole="progressbar" accessibilityLabel={t('screener.loading')} style={headingStyles.loading}>
          <View style={[headingStyles.skeleton, { width: 260, height: 20, backgroundColor: palette.muted }]} />
          <View style={[headingStyles.skeleton, { width: 320, height: 20, backgroundColor: palette.muted }]} />
        </View>
      ) : null}

      {state.status === 'idle' ? (
        <Text tone="muted" variant="meta">{t('screener.idle')}</Text>
      ) : null}

      {state.status === 'empty' ? (
        <View style={headingStyles.emptyGroup}>
          <Text variant="bodyStrong">{t('screener.emptyTitle')}</Text>
          <Text tone="muted" variant="meta">{t('screener.empty')}</Text>
        </View>
      ) : null}
    </View>
  )

  const footer = state.status === 'loaded' ? (
    <View style={headingStyles.footerGroup}>
      {state.loadMoreError ? (
        <Text accessibilityRole="alert" tone="destructive" variant="meta">
          {t('screener.loadMoreError')}
        </Text>
      ) : null}
      {state.hasMore ? (
        <Button
          disabled={state.loadingMore}
          label={state.loadingMore ? t('screener.loadingMore') : t('screener.loadMore')}
          onPress={onLoadMore}
          variant="secondary"
        />
      ) : null}
    </View>
  ) : null

  return (
    <SafeAreaView style={[marketsStyles.safeArea, { backgroundColor: palette.background }]}>
      <FlatList
        data={rows}
        keyExtractor={(row, index) => `${row.symbol}-${index}`}
        renderItem={renderRow}
        initialNumToRender={50}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={headingStyles.content}
        ListHeaderComponent={header}
        ListFooterComponent={footer ?? undefined}
      />
    </SafeAreaView>
  )
}

/**
 * One result: the ticker's mark, the company (or the symbol when the provider
 * sends no name), the symbol and sector beneath, the price right with the
 * market cap under it. Memoized so the growing "load more" result set (which
 * can reach into the hundreds of rows) doesn't re-run price/market-cap
 * formatting for every already-rendered row on each parent re-render.
 */
const ScreenerRowView = memo(function ScreenerRowView({ row, locale, separated, onPress, priceUnavailable, marketCapUnavailable }: {
  row: ScreenerRow
  locale: string
  separated: boolean
  onPress: () => void
  priceUnavailable: string
  marketCapUnavailable: string
}) {
  // Screener prices and market caps arrive without a currency; privacy mode masks them all the same.
  const hideMoney = useHideMoneyText()
  const priceText = row.price === null ? priceUnavailable : hideMoney(formatScreenerPrice(row.price, locale, priceUnavailable), locale)
  const marketCapText = row.marketCap === null ? marketCapUnavailable : hideMoney(formatScreenerMarketCap(row.marketCap, locale, marketCapUnavailable), locale)
  const label = [row.name, row.symbol, row.sector, row.price !== null ? priceText : null].filter(Boolean).join(', ')
  const detail = row.name ? [row.symbol, row.sector].filter(Boolean).join(' · ') : row.sector
  return (
    <ListRow
      accessibilityLabel={label}
      density="comfortable"
      figure={<Text align="right" tone={row.price === null ? 'muted' : 'default'} variant="amount">{priceText}</Text>}
      figureMeta={<Text align="right" tone="muted" variant="amountSmall">{marketCapText}</Text>}
      leading={<EntityMark {...assetMark(row.symbol, null)} />}
      meta={[detail]}
      onPress={onPress}
      separated={separated}
      title={row.name ?? row.symbol}
    />
  )
})

const headingStyles = StyleSheet.create({
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding, width: '100%', maxWidth: 680, alignSelf: 'center' },
  headerGroup: { width: '100%', gap: themeTokens.spacing[6], marginBottom: themeTokens.spacing[4] },
  footerGroup: { width: '100%', gap: themeTokens.spacing[3], marginTop: themeTokens.spacing[3] },
  filters: { gap: themeTokens.spacing[4] },
  loading: { gap: themeTokens.spacing[3] },
  skeleton: { borderRadius: themeTokens.radius.sm },
  emptyGroup: { gap: themeTokens.spacing[2] },
})
