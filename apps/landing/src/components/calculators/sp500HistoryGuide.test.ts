import { describe, expect, it } from "vitest"
import { formatMoney, formatPercent } from "@/lib/numberFormat"
import { SUPPORTED_LANGS } from "@/lib/routes"
import { expectTerms } from "./guideTestUtils"
import { buildSp500HistoryGuide, sp500ExampleResults } from "./sp500HistoryGuide"

const { total, priceOnly, real } = sp500ExampleResults()

describe("S&P 500 history guide content", () => {
	it.each(SUPPORTED_LANGS)("builds every limit and figure in %s", (lang) => {
		const guide = buildSp500HistoryGuide(lang)

		expectTerms(guide.limits)
		expect(guide.limits).toHaveLength(4)
		expect(guide.limitsNote.trim()).not.toBe("")
		for (const figure of guide.figures) {
			expect(figure.label.trim()).not.toBe("")
			expect(figure.label).not.toMatch(/\{\{/)
			expect(figure.detail?.trim()).toBeTruthy()
		}
	})

	it.each(SUPPORTED_LANGS)("takes the example's figures from the calculator in %s", (lang) => {
		const guide = buildSp500HistoryGuide(lang)
		const usd = (value: number) => formatMoney(lang, value, { currency: "USD", decimals: 0 })
		const percent = (value: number) => formatPercent(lang, value, { decimals: 1, sign: "always" })

		expect(guide.figures.map((figure) => figure.value)).toEqual([
			usd(total.finalValue),
			usd(priceOnly.finalValue),
			usd(real.finalValue),
			percent(total.best.returnPct),
			percent(total.worst.returnPct),
		])
		expect(guide.figures[0].detail).toContain(percent(total.cagrPct))
		expect(guide.figures[3].detail).toBe(String(total.best.year))
		// Reinvested dividends add to the price return.
		expect(total.finalValue).toBeGreaterThan(priceOnly.finalValue)
	})
})
