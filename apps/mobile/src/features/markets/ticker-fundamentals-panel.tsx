import { useTranslation } from 'react-i18next'
import { StyleSheet, Text, View } from 'react-native'

import { formatCurrency } from '@/lib/formatters/financial'
import { themeTokens } from '@/theme/tokens'
import { textStyles } from '@/theme/typography'

import { type Palette, ReadOnlyField } from './markets-screen-parts'
import { formatDateOnly, formatScreenerMarketCap, type FundamentalsViewModel } from './markets-view-model'

export type TickerFundamentalsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'loaded'; data: FundamentalsViewModel }

export type TickerFundamentalsPanelProps = Readonly<{
  state: TickerFundamentalsState
  /** From the merged quote/company-info view model — fundamentals carries no currency of its own. */
  currency: string | null
  palette: Palette
}>

function decimalText(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
}

/**
 * Dividend yield is never negative, so this deliberately skips `formatPercent`'s "+"-for-positive
 * signing (meant for changes/deltas, not a plain ratio metric).
 */
function unsignedPercentText(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(value)
}

function FundamentalsMetrics({ data, currency, palette }: { data: FundamentalsViewModel; currency: string | null; palette: Palette }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const unavailable = t('assetDetail.unavailable')
  const amount = (value: number) => (currency ? formatCurrency(value, { locale, currency }) : decimalText(value, locale))
  const weekRangeText = data.fiftyTwoWeekLow !== null && data.fiftyTwoWeekHigh !== null
    ? `${amount(data.fiftyTwoWeekLow)} – ${amount(data.fiftyTwoWeekHigh)}`
    : unavailable

  return (
    <View>
      <ReadOnlyField
        label={t('assetDetail.fundamentals.marketCap')}
        value={data.marketCap === null ? unavailable : formatScreenerMarketCap(data.marketCap, locale, unavailable)}
        palette={palette}
      />
      <ReadOnlyField label={t('assetDetail.fundamentals.weekRange')} value={weekRangeText} palette={palette} separated />
      <ReadOnlyField
        label={t('assetDetail.fundamentals.avgVolume')}
        value={data.avgVolume === null ? unavailable : new Intl.NumberFormat(locale).format(data.avgVolume)}
        palette={palette}
        separated
      />
      <ReadOnlyField
        label={t('assetDetail.fundamentals.peRatio')}
        value={data.peRatio === null ? unavailable : decimalText(data.peRatio, locale)}
        palette={palette}
        separated
      />
      <ReadOnlyField
        label={t('assetDetail.fundamentals.eps')}
        value={data.earningsPerShare === null ? unavailable : amount(data.earningsPerShare)}
        palette={palette}
        separated
      />
      <ReadOnlyField
        label={t('assetDetail.fundamentals.dividendYield')}
        value={data.dividendYield === null ? unavailable : unsignedPercentText(data.dividendYield, locale)}
        palette={palette}
        separated
      />
      <ReadOnlyField
        label={t('assetDetail.fundamentals.beta')}
        value={data.beta === null ? unavailable : decimalText(data.beta, locale)}
        palette={palette}
        separated
      />
      <ReadOnlyField
        label={t('assetDetail.fundamentals.nextEarnings')}
        value={formatDateOnly(data.nextEarningsDate, locale, unavailable)}
        palette={palette}
        separated
      />
    </View>
  )
}

export function TickerFundamentalsPanel({ state, currency, palette }: TickerFundamentalsPanelProps) {
  const { t } = useTranslation()

  return (
    <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.muted }]}>
      <Text accessibilityRole="header" allowFontScaling style={[styles.title, { color: palette.foreground }]}>
        {t('assetDetail.fundamentals.heading')}
      </Text>

      {state.status === 'loading' ? (
        <Text accessibilityRole="progressbar" accessibilityLabel={t('assetDetail.fundamentals.loading')} allowFontScaling style={[styles.helper, { color: palette.mutedForeground }]}>
          {t('assetDetail.fundamentals.loading')}
        </Text>
      ) : state.status === 'error' ? (
        <Text accessibilityRole="alert" allowFontScaling style={[styles.helper, { color: palette.destructive }]}>
          {t('assetDetail.fundamentals.error')}
        </Text>
      ) : (
        <FundamentalsMetrics data={state.data} currency={currency} palette={palette} />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { width: '100%', borderWidth: 1, borderRadius: themeTokens.radius.xl, padding: themeTokens.spacing[4], gap: themeTokens.spacing[3] },
  title: { ...textStyles.section },
  helper: { ...textStyles.body },
})
