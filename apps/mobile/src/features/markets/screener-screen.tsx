import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { FlatList, Pressable, StyleSheet, Switch, Text, TextInput, useColorScheme, View } from 'react-native'
import type { ListRenderItemInfo } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BackControl } from '@/components/ui/back-control'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import { AVAILABLE_COUNTRIES, AVAILABLE_EXCHANGES, AVAILABLE_INDUSTRIES, AVAILABLE_SECTORS } from './screener-canonical-lists'
import { CanonicalValuePicker } from './canonical-value-picker'
import { MarketsFailure, marketsStyles, type Palette } from './markets-screen-parts'
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

export type ScreenerScreenProps = {
  state: ScreenerScreenState
  form: ScreenerFilterFormValues
  onFormChange: (patch: Partial<ScreenerFilterFormValues>) => void
  onApplyFilters: () => void
  onLoadMore: () => void
  onSelectSymbol: (symbol: string) => void
  onBack: () => void
}

/**
 * The filter form is a heavier, explicit-submit version
 * of markets-search-screen's controlled input: five plain TextInputs stage
 * changes via onFormChange (no request fires per keystroke), and only the
 * "Apply filters" action fetches. Below the form, a results list mirrors
 * watchlist-screen's row/list shape but paginated: a "Load more" action
 * appears whenever `hasMore` is true, mirroring goal-detail-screen's
 * load-more convention (loadingMore disables it, loadMoreError shows a
 * scoped note beside the list rather than replacing it with a full error).
 */
export function ScreenerScreen({ state, form, onFormChange, onApplyFilters, onLoadMore, onSelectSymbol, onBack }: ScreenerScreenProps) {
  const { t, i18n } = useTranslation()
  const palette = themeTokens.colors[useColorScheme() === 'dark' ? 'dark' : 'light']
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'

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
        onRetry={onApplyFilters}
        palette={palette}
      />
    )
  }

  const priceUnavailable = t('screener.priceUnavailable')
  const marketCapUnavailable = t('screener.marketCapUnavailable')
  const rows = state.status === 'loaded' ? state.rows : []
  const renderRow = ({ item, index }: ListRenderItemInfo<ScreenerRow>) => (
    <ScreenerRowView
      row={item}
      palette={palette}
      locale={locale}
      separated={index > 0}
      isFirst={index === 0}
      isLast={index === rows.length - 1}
      onPress={() => onSelectSymbol(item.symbol)}
      priceUnavailable={priceUnavailable}
      marketCapUnavailable={marketCapUnavailable}
    />
  )

  const header = (
    <View style={headingStyles.headerGroup}>
      <BackControl fallback="/more" label={t('screener.back')} onPress={onBack} />

      <PageHeader palette={palette}
            helpText={t('screener.helper')} title={t('screener.title')} />

      <View style={[headingStyles.form, { borderColor: palette.border, backgroundColor: palette.card }]}>
        <Toggle
          label={t('screener.isEtfLabel')}
          value={form.isEtf}
          onValueChange={(value) => onFormChange({ isEtf: value })}
          palette={palette}
        />
        <Toggle
          label={t('screener.isActivelyTradingLabel')}
          value={form.isActivelyTrading}
          onValueChange={(value) => onFormChange({ isActivelyTrading: value })}
          palette={palette}
        />
        <View style={headingStyles.formRow}>
          <Field
            label={t('screener.priceMoreThanLabel')}
            value={form.priceMoreThan}
            onChangeText={(value) => onFormChange({ priceMoreThan: value })}
            palette={palette}
            keyboardType="decimal-pad"
            style={headingStyles.formHalf}
          />
          <Field
            label={t('screener.priceLowerThanLabel')}
            value={form.priceLowerThan}
            onChangeText={(value) => onFormChange({ priceLowerThan: value })}
            palette={palette}
            keyboardType="decimal-pad"
            style={headingStyles.formHalf}
          />
        </View>
        <View style={headingStyles.formRow}>
          <Field
            label={t('screener.marketCapMoreThanLabel')}
            value={form.marketCapMoreThan}
            onChangeText={(value) => onFormChange({ marketCapMoreThan: value })}
            palette={palette}
            keyboardType="decimal-pad"
            style={headingStyles.formHalf}
          />
          <Field
            label={t('screener.marketCapLowerThanLabel')}
            value={form.marketCapLowerThan}
            onChangeText={(value) => onFormChange({ marketCapLowerThan: value })}
            palette={palette}
            keyboardType="decimal-pad"
            style={headingStyles.formHalf}
          />
        </View>
        <CanonicalValuePicker label={t('screener.sectorLabel')} options={AVAILABLE_SECTORS} selected={form.sector} onSelect={(value) => onFormChange({ sector: value })} palette={palette} />
        <CanonicalValuePicker label={t('screener.industryLabel')} options={AVAILABLE_INDUSTRIES} selected={form.industry} onSelect={(value) => onFormChange({ industry: value })} palette={palette} />
        <CanonicalValuePicker label={t('screener.countryLabel')} options={AVAILABLE_COUNTRIES} selected={form.country} onSelect={(value) => onFormChange({ country: value })} palette={palette} />
        <CanonicalValuePicker label={t('screener.exchangeLabel')} options={AVAILABLE_EXCHANGES} selected={form.exchange} onSelect={(value) => onFormChange({ exchange: value })} palette={palette} />
        <Button label={t('screener.apply')} onPress={onApplyFilters} palette={palette} variant="primary" />
      </View>

      {state.status === 'loading' ? (
        <View accessible accessibilityRole="progressbar" accessibilityLabel={t('screener.loading')} style={headingStyles.loading}>
          <View style={[headingStyles.skeleton, { width: 260, height: 20, backgroundColor: palette.muted }]} />
          <View style={[headingStyles.skeleton, { width: 320, height: 20, backgroundColor: palette.muted }]} />
        </View>
      ) : null}

      {state.status === 'idle' ? (
        <Text allowFontScaling style={[headingStyles.empty, { color: palette.mutedForeground }]}>
          {t('screener.idle')}
        </Text>
      ) : null}

       {state.status === 'empty' ? (
         <View style={headingStyles.emptyGroup}>
           <Text allowFontScaling style={[headingStyles.emptyTitle, { color: palette.foreground }]}>{t('screener.emptyTitle')}</Text>
           <Text allowFontScaling style={[headingStyles.empty, { color: palette.mutedForeground }]}>{t('screener.empty')}</Text>
         </View>
       ) : null}
    </View>
  )

  const footer = state.status === 'loaded' ? (
    <View style={headingStyles.footerGroup}>
      {state.loadMoreError ? (
        <Text accessibilityRole="alert" allowFontScaling style={[headingStyles.note, { color: palette.destructive }]}>
          {t('screener.loadMoreError')}
        </Text>
      ) : null}
      {state.hasMore ? (
        <Button
          disabled={state.loadingMore}
          label={state.loadingMore ? t('screener.loadingMore') : t('screener.loadMore')}
          onPress={onLoadMore}
          palette={palette}
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
        ListFooterComponent={footer}
      />
    </SafeAreaView>
  )
}

function Toggle({ label, value, onValueChange, palette }: {
  label: string
  value: boolean
  onValueChange: (value: boolean) => void
  palette: Palette
}) {
  return (
    <View style={headingStyles.switchRow}>
      <Text allowFontScaling style={[headingStyles.fieldLabel, { color: palette.foreground }]}>{label}</Text>
      <Switch
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityState={{ checked: value }}
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: palette.muted, true: palette.primary }}
      />
    </View>
  )
}

function Field({ label, placeholder, value, onChangeText, palette, keyboardType = 'default', style }: {
  label: string
  placeholder?: string
  value: string
  onChangeText: (value: string) => void
  palette: Palette
  keyboardType?: 'default' | 'decimal-pad'
  style?: object
}) {
  return (
    <View style={[headingStyles.field, style]}>
      <Text allowFontScaling style={[headingStyles.fieldLabel, { color: palette.foreground }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholder={placeholder}
        placeholderTextColor={palette.mutedForeground}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
        allowFontScaling
        style={[headingStyles.input, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.background }]}
      />
    </View>
  )
}

/**
 * Memoized so the screener's growing "load more" result set (which
 * can reach into the hundreds of rows) doesn't re-run price/market-cap
 * formatting for every already-rendered row on each parent re-render.
 */
const ScreenerRowView = memo(function ScreenerRowView({ row, palette, locale, separated, isFirst, isLast, onPress, priceUnavailable, marketCapUnavailable }: {
  row: ScreenerRow
  palette: Palette
  locale: string
  separated: boolean
  isFirst: boolean
  isLast: boolean
  onPress: () => void
  priceUnavailable: string
  marketCapUnavailable: string
}) {
  const priceText = formatScreenerPrice(row.price, locale, priceUnavailable)
  const marketCapText = formatScreenerMarketCap(row.marketCap, locale, marketCapUnavailable)
  const label = [row.name, row.symbol, row.sector, row.price !== null ? priceText : null].filter(Boolean).join(', ')
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        headingStyles.row,
        { borderColor: palette.border },
        isFirst && headingStyles.rowFirst,
        isLast && headingStyles.rowLast,
        separated && { borderTopWidth: 1, borderTopColor: palette.border },
        pressed && headingStyles.pressed,
      ]}
    >
      <View style={headingStyles.rowIdentity}>
        {row.name ? <Text allowFontScaling style={[headingStyles.rowName, { color: palette.foreground }]}>{row.name}</Text> : null}
        <Text allowFontScaling style={[headingStyles.rowSymbol, { color: row.name ? palette.mutedForeground : palette.foreground }]}>
          {row.symbol}{row.sector ? ` · ${row.sector}` : ''}
        </Text>
      </View>
      <View style={headingStyles.rowMetrics}>
        <Text allowFontScaling style={[headingStyles.rowPrice, { color: palette.foreground }]}>{priceText}</Text>
        <Text allowFontScaling style={[headingStyles.rowMarketCap, { color: palette.mutedForeground }]}>{marketCapText}</Text>
      </View>
    </Pressable>
  )
})

const headingStyles = StyleSheet.create({
  content: { flexGrow: 1, padding: themeTokens.layout.screenPadding, width: '100%', maxWidth: 680, alignSelf: 'center' },
  headerGroup: { width: '100%', gap: themeTokens.spacing[6], marginBottom: themeTokens.spacing[6] },
  footerGroup: { width: '100%', gap: themeTokens.spacing[3], marginTop: themeTokens.spacing[3] },
  form: { width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.lg, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] },
  formRow: { flexDirection: 'row', gap: themeTokens.spacing[3] },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: themeTokens.touchTarget.minimum },
  formHalf: { flex: 1 },
  field: { gap: themeTokens.spacing[2] },
  fieldLabel: { ...textStyles.meta, fontWeight: '600' as const },
  input: { ...textStyles.body, minHeight: themeTokens.touchTarget.minimum, borderWidth: 1, borderRadius: themeTokens.radius.md, paddingHorizontal: themeTokens.spacing[4] },
  loading: { gap: themeTokens.spacing[3] },
  skeleton: { borderRadius: themeTokens.radius.sm },
  empty: { ...textStyles.body }, emptyGroup: { gap: themeTokens.spacing[2] }, emptyTitle: { ...textStyles.section },
  results: { width: '100%', gap: themeTokens.spacing[3] },
  note: { ...textStyles.meta },
  row: {
    width: '100%',
    minHeight: themeTokens.touchTarget.minimum,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: themeTokens.spacing[4],
    gap: themeTokens.spacing[3],
    borderLeftWidth: 1,
    borderRightWidth: 1,
  },
  rowFirst: { borderTopWidth: 1, borderTopLeftRadius: themeTokens.radius.lg, borderTopRightRadius: themeTokens.radius.lg },
  rowLast: { borderBottomWidth: 1, borderBottomLeftRadius: themeTokens.radius.lg, borderBottomRightRadius: themeTokens.radius.lg, overflow: 'hidden' },
  rowIdentity: { flex: 1, gap: themeTokens.spacing[1] },
  rowName: { ...textStyles.section },
  rowSymbol: { ...textStyles.amountSmall },
  rowMetrics: { alignItems: 'flex-end', gap: themeTokens.spacing[1] },
  rowPrice: { ...textStyles.amount },
  rowMarketCap: { ...textStyles.amountSmall },
  pressed: { opacity: 0.72 },
})
