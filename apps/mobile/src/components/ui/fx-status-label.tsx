import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { Badge } from '@/components/ui/badge'
import { Text } from '@/components/ui/text'
import { formatRateDate, type FxState } from '@/lib/api/fx-status'
import { themeTokens } from '@/theme/tokens'

export type FxStatusCopy = Readonly<{ label: string; hint: string }>

/**
 * The words for an amount that was not converted, or was converted at an old rate: a short label
 * for the badge and a sentence for screen readers. Null for an exact amount.
 */
export function describeFxState(state: FxState, t: TFunction, locale: string): FxStatusCopy | null {
  if (state.status === 'missing') {
    return {
      label: t('fxStatus.missing.label'),
      hint: state.currency ? t('fxStatus.missing.hint', { currency: state.currency }) : t('fxStatus.missing.hintNoCurrency'),
    }
  }
  if (state.status === 'provisional') {
    return state.rateDate
      ? { label: t('fxStatus.provisional.label'), hint: t('fxStatus.provisional.hint', { date: formatRateDate(state.rateDate, locale) }) }
      : { label: t('fxStatus.provisional.label'), hint: t('fxStatus.provisional.hintNoDate') }
  }
  return null
}

/**
 * Web's FX status badge: "Not converted" beside an amount with no exchange rate, "Estimated" with
 * the rate's date beside one converted at an old rate. Renders nothing for an exact amount. A row
 * that is itself one accessible element repeats {@link describeFxState} in its own label.
 */
export function FxStatusLabel({ state, locale, testID = 'fx-status-label' }: { state: FxState; locale: string; testID?: string }) {
  const { t } = useTranslation()
  const copy = describeFxState(state, t, locale)
  if (!copy) return null
  const rateDate = state.status === 'provisional' && state.rateDate ? formatRateDate(state.rateDate, locale) : null
  return (
    <View accessible accessibilityLabel={`${copy.label}. ${copy.hint}`} style={styles.line} testID={testID}>
      <Badge label={copy.label} tone="outline" />
      {rateDate ? <Text tone="muted" variant="label">{t('fxStatus.provisional.rateOf', { date: rateDate })}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: themeTokens.spacing[1] },
})
