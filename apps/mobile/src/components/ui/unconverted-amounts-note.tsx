import { useTranslation } from 'react-i18next'

import { Text } from '@/components/ui/text'
import type { AmountsCompleteness } from '@/lib/api/completeness'

/** "GBP and USD": Intl.ListFormat where the engine has it, a comma-separated list where it doesn't. */
export function formatCurrencyList(currencies: readonly string[], locale: string): string {
  try {
    if (typeof Intl.ListFormat === 'function') return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(currencies)
  } catch {
    // An unsupported locale falls through to the plain list.
  }
  return currencies.join(', ')
}

/**
 * Web's `UnconvertedAmountsNotice`: says that a total leaves rows out because their currency has no
 * exchange rate yet, so a partial total never reads as a whole one. Renders nothing when the total
 * is complete or the API sent no completeness.
 */
export function UnconvertedAmountsNote({ completeness, testID = 'unconverted-amounts-note' }: { completeness: AmountsCompleteness | null | undefined; testID?: string }) {
  const { t, i18n } = useTranslation()
  if (!completeness || completeness.isComplete !== false) return null

  const count = completeness.unconvertedTransactions ?? 0
  const currencies = completeness.unconvertedCurrencies ?? []
  const message = currencies.length > 0
    ? t('unconvertedAmounts.withCurrencies', { count, currencies: formatCurrencyList(currencies, i18n.resolvedLanguage ?? i18n.language ?? 'en') })
    : t('unconvertedAmounts.noCurrency', { count })

  return <Text testID={testID} tone="muted" variant="meta">{message}</Text>
}
