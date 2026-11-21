import { describe, expect, it } from "vitest"
import { INFLATION_EXAMPLE, computeInflation } from "@/lib/calculators/inflation"
import { formatMoney } from "@/lib/numberFormat"
import { SUPPORTED_LANGS } from "@/lib/routes"
import { buildInflationGuide } from "./inflationGuide"
import { expectFigures } from "./guideTestUtils"

const result = computeInflation(INFLATION_EXAMPLE)

describe("inflation guide content", () => {
	it.each(SUPPORTED_LANGS)("takes the example's figures from the calculator in %s", (lang) => {
		const guide = buildInflationGuide(lang)
		const money = (value: number) => formatMoney(lang, value, { decimals: 2 })

		expectFigures([...guide.budget, ...guide.investment])
		expect(guide.budget.map((figure) => figure.value)).toEqual([money(INFLATION_EXAMPLE.amount), money(result!.equivalent)])
		expect(guide.investment.map((figure) => figure.value)).toEqual([
			money(INFLATION_EXAMPLE.finalValue),
			money(result!.realValue as number),
		])
		// The labels carry the example's years.
		expect(guide.budget[0].label).toContain(String(INFLATION_EXAMPLE.from))
		expect(guide.budget[1].label).toContain(String(INFLATION_EXAMPLE.to))
	})

	it.each(SUPPORTED_LANGS)("writes both formulas in words in %s", (lang) => {
		const guide = buildInflationGuide(lang)

		expect(guide.formulas).toHaveLength(2)
		for (const line of guide.formulas) expect(line.result.label.trim()).not.toBe("")
	})
})
