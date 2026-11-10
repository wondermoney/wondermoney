import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { usePrivacyMode } from '@/lib/privacy/privacy-mode'

import { formatCurrency } from './financial'

/**
 * The fixed stand-in for a hidden amount. Fixed width on purpose: a mask whose
 * length followed the figure would still tell €12 from €12,000.
 */
export const PRIVACY_MASK = '•••••'

export type MoneyOptions = Readonly<{
  locale: string
  /** `null` for an amount whose currency is unknown: a plain decimal, still masked. */
  currency: string | null
  minimumFractionDigits?: number
  maximumFractionDigits?: number
}>

/**
 * The mask, with the currency symbol where the locale puts it: `€•••••` in
 * `en`, `••••• €` in `pt-PT`. Read off a formatted zero, not a template, and
 * without `formatToParts`, which Hermes does not implement everywhere.
 */
export function maskMoney(locale: string, currency?: string | null): string {
  if (!currency) return PRIVACY_MASK
  try {
    const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency })
    const full = formatter.format(0)
    const { minimumFractionDigits, maximumFractionDigits } = formatter.resolvedOptions()
    const number = new Intl.NumberFormat(locale, { minimumFractionDigits, maximumFractionDigits }).format(0)
    const at = full.indexOf(number)
    if (at < 0) return `${PRIVACY_MASK} ${currency}`
    return `${full.slice(0, at)}${PRIVACY_MASK}${full.slice(at + number.length)}`
  } catch {
    return `${PRIVACY_MASK} ${currency}`
  }
}

/**
 * Money as text for the screen: `formatCurrency` when shown, the mask when
 * privacy mode is on. UI code formats money through this (or `useFormatMoney`)
 * or `Amount`, never `formatCurrency` directly; lint enforces it.
 */
export function formatMoneyForDisplay(value: number, options: MoneyOptions, hidden: boolean): string {
  if (hidden) return maskMoney(options.locale, options.currency)
  return reveal(value, options)
}

function reveal(value: number, { locale, currency, minimumFractionDigits, maximumFractionDigits }: MoneyOptions): string {
  if (currency) return formatCurrency(value, { locale, currency, minimumFractionDigits, maximumFractionDigits })
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: minimumFractionDigits ?? Math.min(2, maximumFractionDigits ?? 2),
    maximumFractionDigits: maximumFractionDigits ?? 2,
  }).format(value)
}

/** `formatCurrency`'s signature, bound to the device's privacy mode. */
export function useFormatMoney(): (value: number, options: MoneyOptions) => string {
  const { hidden } = usePrivacyMode()
  return useCallback((value: number, options: MoneyOptions) => formatMoneyForDisplay(value, options, hidden), [hidden])
}

/**
 * Compact money (`$1.2B`) for figures in the billions, such as company
 * financials, masked like every other amount in privacy mode.
 */
export function useFormatCompactMoney(): (value: number, options: Pick<MoneyOptions, 'locale' | 'currency'>) => string {
  const { hidden } = usePrivacyMode()
  return useCallback((value: number, { locale, currency }: Pick<MoneyOptions, 'locale' | 'currency'>) => {
    if (hidden) return maskMoney(locale, currency)
    return new Intl.NumberFormat(locale, {
      notation: 'compact',
      maximumFractionDigits: 1,
      ...(currency ? { style: 'currency', currency } : {}),
    }).format(value)
  }, [hidden])
}

/**
 * Money for an accessibility label: the formatted value when shown, the words
 * "Hidden amount" when privacy mode is on, so a screen reader neither reads the
 * value nor spells out the mask's bullets.
 */
export function useMoneyLabel(): (value: number, options: MoneyOptions) => string {
  const { hidden } = usePrivacyMode()
  const { t } = useTranslation()
  return useCallback(
    (value: number, options: MoneyOptions) => (hidden ? t('privacy.hiddenAmount') : reveal(value, options)),
    [hidden, t],
  )
}

/**
 * Hides amount text that was formatted elsewhere (a compact axis label, a
 * figure from a view model) when privacy mode is on.
 */
export function useHideMoneyText(): (text: string, locale: string, currency?: string | null) => string {
  const { hidden } = usePrivacyMode()
  return useCallback(
    (text: string, locale: string, currency?: string | null) => (hidden ? maskMoney(locale, currency) : text),
    [hidden],
  )
}

export type QuantityOptions = Readonly<{
  locale: string
  maximumFractionDigits?: number
}>

/**
 * How many units of an asset a holding or trade has, or the mask when privacy
 * mode is on: quantity times the asset's public price is the position's value,
 * so it hides like money, with the same fixed-width mask.
 */
export function formatQuantityForDisplay(value: number, { locale, maximumFractionDigits = 8 }: QuantityOptions, hidden: boolean): string {
  if (hidden) return PRIVACY_MASK
  return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value)
}

/** `formatQuantityForDisplay` bound to the device's privacy mode. */
export function useFormatQuantity(): (value: number, options: QuantityOptions) => string {
  const { hidden } = usePrivacyMode()
  return useCallback((value: number, options: QuantityOptions) => formatQuantityForDisplay(value, options, hidden), [hidden])
}
