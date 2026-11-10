import { useTranslation } from 'react-i18next'
import { StyleSheet, Text, View } from 'react-native'

import { useFormatMoney, useHideMoneyText } from '@/lib/formatters/money-display'
import { Section } from '@/components/ui/section'
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
  const formatMoney = useFormatMoney()
  const hideMoney = useHideMoneyText()
  const amount = (value: number) => formatMoney(value, { locale, currency })
  const weekRangeText = data.fiftyTwoWeekLow !== null && data.fiftyTwoWeekHigh !== null
    ? `${amount(data.fiftyTwoWeekLow)} – ${amount(data.fiftyTwoWeekHigh)}`
    : unavailable

  return (
    <View>
      <ReadOnlyField
        label={t('assetDetail.fundamentals.marketCap')}
        value={data.marketCap === null ? unavailable : hideMoney(formatScreenerMarketCap(data.marketCap, locale, unavailable), locale)}
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
    <Section title={t('assetDetail.fundamentals.heading')} variant="open">

      {state.status === 'loading' ? (
        <Text accessibilityRole="progressbar" accessibilityLabel={t('assetDetail.fundamentals.loading')} allowFontScaling style={[styles.helper, { color: palette.mutedForeground }]}>
          {t('assetDetail.fundamentals.loading')}
        </Text>
      ) : state.status === 'error' ? (
        <Text accessibilityRole="alert" allowFontScaling style={[styles.helper, { color: palette.destructiveText }]}>
          {t('assetDetail.fundamentals.error')}
        </Text>
      ) : (
        <FundamentalsMetrics data={state.data} currency={currency} palette={palette} />
      )}
    </Section>
  )
}

const styles = StyleSheet.create({
  helper: { ...textStyles.meta },
})
