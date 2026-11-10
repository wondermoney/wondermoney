import { useMemo } from "react"

import {
	formatMoney,
	formatMonth,
	formatMonthYear,
	formatNumber,
	formatPercent,
	type MoneyOptions,
	type PercentOptions,
} from "./numberFormat"
import { useTranslations } from "./reactTranslations"

/** Locale-bound formatters for the product-preview mockups. */
export function usePreviewFormat() {
	const { locale } = useTranslations()

	return useMemo(
		() => ({
			money: (value: number, options?: MoneyOptions) => formatMoney(locale, value, options),
			pct: (value: number, options?: PercentOptions) => formatPercent(locale, value, options),
			num: (value: number, decimals?: number) => formatNumber(locale, value, decimals),
			monthYear: (date: Date) => formatMonthYear(locale, date),
			month: (date: Date) => formatMonth(locale, date),
		}),
		[locale],
	)
}

export type PreviewFormat = ReturnType<typeof usePreviewFormat>
