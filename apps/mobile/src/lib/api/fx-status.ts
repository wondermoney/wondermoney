import { z } from 'zod'

import { tolerantEnum } from '@/lib/api/runtime-schema'

/**
 * How an amount shown in the user's currency was converted (`fxStatus` on transaction rows and
 * account summaries). A value this build doesn't know, or a field an older API doesn't send,
 * reads as null: the amount is then judged by whether it has a converted value at all.
 */
export const fxStatusSchema = tolerantEnum(['exact', 'missing', 'provisional'], null).nullish().catch(null)

/** The date (`YYYY-MM-DD`) of the old rate a provisional amount was converted at. */
export const fxRateDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().catch(null)

/**
 * - `exact`: nothing to say.
 * - `missing`: no exchange rate, so there is no converted amount; show the original one.
 * - `provisional`: converted at an older rate, dated `rateDate`, until a newer one arrives.
 */
export type FxState =
  | Readonly<{ status: 'exact' }>
  | Readonly<{ status: 'missing'; amount: number | null; currency: string | null }>
  | Readonly<{ status: 'provisional'; rateDate: string | null }>

export type FxInput = Readonly<{
  fxStatus?: 'exact' | 'missing' | 'provisional' | null
  fxRateDate?: string | null
  /** The amount in the user's currency, null when none is stored. */
  converted: number | null | undefined
  /** The amount in its own currency. */
  original: number | null | undefined
  fromCurrency: string | null | undefined
  toCurrency: string | null | undefined
}>

const EXACT: FxState = Object.freeze({ status: 'exact' })

export function resolveFxState(input: FxInput): FxState {
  const { fromCurrency, toCurrency } = input
  if (fromCurrency && toCurrency && fromCurrency === toCurrency) return EXACT
  const missing: FxState = { status: 'missing', amount: input.original ?? null, currency: fromCurrency ?? null }
  if (input.fxStatus === 'missing') return missing
  if (input.fxStatus === 'provisional') return { status: 'provisional', rateDate: input.fxRateDate ?? null }
  if (input.fxStatus === 'exact') return EXACT
  // No status: a legacy row, or an older API. One with no converted amount in another currency
  // was not converted.
  return input.converted == null && fromCurrency && toCurrency ? missing : EXACT
}

/** "3 Nov 2026" for a `YYYY-MM-DD` rate date, read as a calendar day (no time zone shift). */
export function formatRateDate(rateDate: string, locale: string): string {
  const date = new Date(`${rateDate}T00:00:00.000Z`)
  if (!Number.isFinite(date.getTime())) return rateDate
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(date)
  } catch {
    return rateDate
  }
}
