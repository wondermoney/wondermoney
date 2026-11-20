// Localized wording of the PPR figures, shared by the island and the prerendered guide.
import type { Lang } from "../i18nLocale"
import { formatMoney, formatPercent } from "../numberFormat"
import type { Translate } from "../translations"
import { decimalsFor, formatCheckedDate } from "./brokerFeesFormat"
import type { PprFeeRange, PprProduct } from "./pprTypes"

export { formatCheckedDate }

const k = (key: string) => `tools.pprComparison.${key}`

export function createPprFormat(t: Translate, locale: Lang) {
	const notPublished = t(k("labels.notPublished"))
	/** A published product figure, always with two decimals as the sources give them: "0.65%". */
	const percent = (value: number) => formatPercent(locale, value, { decimals: 2 })
	/** A rate set in law, with the decimals it needs: "20%", "21.5%". */
	const rate = (value: number) => formatPercent(locale, value, { decimals: decimalsFor(value) })
	const eur = (value: number) => formatMoney(locale, value, { currency: "EUR", decimals: Number.isInteger(value) ? 0 : 2 })
	const maybePercent = (value: number | null) => (value === null ? notPublished : percent(value))
	/** "0%", "0% to 2%": the lowest and highest rate the contract allows. */
	const feeRange = (range: PprFeeRange | null) => {
		if (!range) return notPublished
		return range[0] === range[1] ? percent(range[0]) : t(k("labels.feeRange"), { min: percent(range[0]), max: percent(range[1]) })
	}
	const productName = (item: PprProduct) =>
		item.shareClass ? t(k("labels.withClass"), { name: item.name, shareClass: item.shareClass }) : item.name
	const kind = (item: PprProduct) => t(k(`kinds.${item.kind}`))
	const risk = (item: PprProduct) =>
		item.riskClass === null ? notPublished : t(k("labels.riskValue"), { risk: String(item.riskClass) })
	return { notPublished, percent, rate, eur, maybePercent, feeRange, productName, kind, risk, date: (iso: string) => formatCheckedDate(locale, iso) }
}
