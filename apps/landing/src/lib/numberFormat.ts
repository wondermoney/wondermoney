import type { Lang } from "./i18nLocale"

/**
 * The Intl locale for each site language. A bare "pt" resolves to Brazilian
 * conventions ("€ 2.450,00"); the site speaks to Portugal ("2450,00 €").
 */
const INTL_LOCALE = {
	pt: "pt-PT",
	en: "en-IE",
	es: "es-ES",
	fr: "fr-FR",
	de: "de-DE",
	it: "it-IT",
} as const satisfies Record<Lang, string>

export function toIntlLocale(lang: Lang): string {
	return INTL_LOCALE[lang]
}

export type MoneyOptions = {
	currency?: "EUR" | "USD"
	/** Fixed fraction digits (default 0). */
	decimals?: number
	/** "always" prefixes a plus on gains. */
	sign?: "auto" | "always"
	/** Compact notation for large figures, e.g. a market cap. */
	compact?: boolean
}

export function formatMoney(
	lang: Lang,
	value: number,
	{ currency = "EUR", decimals = 0, sign = "auto", compact = false }: MoneyOptions = {},
): string {
	return new Intl.NumberFormat(toIntlLocale(lang), {
		style: "currency",
		currency,
		notation: compact ? "compact" : "standard",
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals,
		signDisplay: sign,
	}).format(value)
}

export type PercentOptions = {
	/** Fixed fraction digits (default 1). */
	decimals?: number
	sign?: "auto" | "always"
}

/** `value` is in percent units: 12.4 renders as "12,4%" in pt. */
export function formatPercent(lang: Lang, value: number, { decimals = 1, sign = "auto" }: PercentOptions = {}): string {
	return new Intl.NumberFormat(toIntlLocale(lang), {
		style: "percent",
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals,
		signDisplay: sign,
	}).format(value / 100)
}

export function formatNumber(lang: Lang, value: number, decimals = 0): string {
	return new Intl.NumberFormat(toIntlLocale(lang), {
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals,
	}).format(value)
}

/** A month and year, e.g. "mar. de 2029" in pt. */
export function formatMonthYear(lang: Lang, date: Date): string {
	return new Intl.DateTimeFormat(toIntlLocale(lang), { month: "short", year: "numeric", timeZone: "UTC" }).format(date)
}

/** A short month name, e.g. "mai." in pt. */
export function formatMonth(lang: Lang, date: Date): string {
	return new Intl.DateTimeFormat(toIntlLocale(lang), { month: "short", timeZone: "UTC" }).format(date)
}
