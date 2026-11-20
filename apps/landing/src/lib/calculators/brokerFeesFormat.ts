// Localized wording of the broker fee formulas, shared by the island and the prerendered guide so
// both write a fee the same way: "€3 + 0.1% (min €5)".
import type { CustodyFee, OrderFee } from "./data/brokerFees"
import type { Lang } from "../i18nLocale"
import { formatMoney, formatMonth, formatNumber, formatPercent } from "../numberFormat"
import type { Translate } from "../translations"

const k = (key: string) => `tools.brokerFees.${key}`

/** "20 nov. 2026": composed from the short month name, like formatMonthYear, so it hydrates. */
export function formatCheckedDate(locale: Lang, iso: string): string {
	const date = new Date(`${iso}T00:00:00Z`)
	return `${date.getUTCDate()} ${formatMonth(locale, date)} ${date.getUTCFullYear()}`
}

/** The fewest decimals, from `atLeast` up to four, that show the value exactly. */
export function decimalsFor(value: number, atLeast = 0): number {
	for (let decimals = atLeast; decimals < 4; decimals += 1) {
		const scaled = value * 10 ** decimals
		if (Math.abs(Math.round(scaled) - scaled) < 1e-9) return decimals
	}
	return 4
}

export function createFeeFormat(t: Translate, locale: Lang) {
	const money = (value: number, currency: "EUR" | "USD" = "EUR") =>
		formatMoney(locale, value, { currency, decimals: Number.isInteger(value) ? 0 : decimalsFor(value, 2) })
	const eur2 = (value: number) => formatMoney(locale, value, { currency: "EUR", decimals: 2 })
	const percent = (value: number) => formatPercent(locale, value, { decimals: decimalsFor(value) })
	const number = (value: number) => formatNumber(locale, value, decimalsFor(value))

	/** "€3 + 0.1% (min €5, max €50)", or "free up to €100,000 of orders a month, then 0.2% (min €10)". */
	const orderFee = (fee: OrderFee): string => {
		const parts: string[] = []
		if (fee.tiers) {
			const bands = fee.tiers.map((band, index) => {
				const price = [band.fixed > 0 ? money(band.fixed, fee.currency) : null, band.pct > 0 ? percent(band.pct) : null]
					.filter(Boolean)
					.join(" + ")
				if (band.upTo !== null) return t(k("formula.tierUpTo"), { fee: price, amount: money(band.upTo, fee.currency) })
				const previous = fee.tiers?.[index - 1]?.upTo ?? 0
				return t(k("formula.tierAbove"), { fee: price, amount: money(previous, fee.currency) })
			})
			parts.push(bands.join("; "))
		} else {
			if (fee.fixed > 0) parts.push(money(fee.fixed, fee.currency))
			if (fee.pct > 0) parts.push(percent(fee.pct))
		}
		if (fee.perShare > 0) parts.push(t(k("formula.perShare"), { amount: money(fee.perShare, fee.currency) }))
		const limits: string[] = []
		if (fee.min > 0) limits.push(t(k("formula.min"), { amount: money(fee.min, fee.currency) }))
		if (fee.max !== null) limits.push(t(k("formula.max"), { amount: money(fee.max, fee.currency) }))
		if (fee.maxPctOfValue !== null) limits.push(t(k("formula.maxPct"), { pct: percent(fee.maxPctOfValue) }))
		let formula = parts.length > 0 ? parts.join(" + ") : t(k("formula.noFee"))
		if (limits.length > 0) formula = `${formula} (${limits.join(", ")})`
		if (fee.freeMonthlyTurnover !== null)
			formula = t(k("formula.freeUpTo"), { amount: money(fee.freeMonthlyTurnover), fee: formula })
		if (fee.freeOrdersPerMonth > 0)
			formula = t(k("formula.freeOrders"), { count: String(fee.freeOrdersPerMonth), fee: formula })
		return formula
	}

	/** "0.1% a semester (min €5)", or "no custody fee". */
	const custody = (fee: CustodyFee): string => {
		const parts: string[] = []
		if (fee.fixed > 0) parts.push(money(fee.fixed))
		if (fee.pct > 0) parts.push(percent(fee.pct))
		if (parts.length === 0) return t(k("formula.noCustody"))
		const limits: string[] = []
		if (fee.min > 0) limits.push(t(k("formula.min"), { amount: money(fee.min) }))
		if (fee.max !== null) limits.push(t(k("formula.max"), { amount: money(fee.max) }))
		let base = t(k(`formula.period.${fee.period}`), { fee: parts.join(" + ") })
		if (fee.exemptValue > 0) base = `${base} ${t(k("formula.above"), { amount: money(fee.exemptValue) })}`
		return limits.length > 0 ? `${base} (${limits.join(", ")})` : base
	}

	return { money, eur2, percent, number, orderFee, custody }
}
