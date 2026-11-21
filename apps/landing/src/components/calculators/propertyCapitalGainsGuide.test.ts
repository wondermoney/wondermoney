import { describe, expect, it } from "vitest"
import { CAPITAL_GAINS_EXAMPLE, computeCapitalGains } from "@/lib/calculators/propertyCapitalGains"
import { formatMoney } from "@/lib/numberFormat"
import { SUPPORTED_LANGS } from "@/lib/routes"
import { formulaHrefs } from "./guideBlocks"
import { expectGuideParts, expectStableIds } from "./guideTestKit"
import { PROPERTY_CAPITAL_GAINS_GUIDE_IDS, buildPropertyCapitalGainsGuide } from "./propertyCapitalGainsGuide"

const calculation = computeCapitalGains(CAPITAL_GAINS_EXAMPLE)
if (!calculation.ok) throw new Error("invalid example")
const result = calculation.result

describe("property capital gains guide content", () => {
	it.each(SUPPORTED_LANGS)("builds every term, figure and formula in %s", (lang) => {
		const guide = buildPropertyCapitalGainsGuide(lang)
		expectGuideParts({
			terms: [...guide.notes, ...guide.scope, ...guide.assumptions],
			figures: [...guide.update, ...guide.gain, ...guide.tax],
			formulas: guide.formulas,
		})
		expect(formulaHrefs(guide.formulas).length).toBeGreaterThanOrEqual(15)
	})

	it("keeps the same note ids in every locale", () => {
		expectStableIds((lang) => {
			const guide = buildPropertyCapitalGainsGuide(lang)
			return [...guide.notes, ...guide.assumptions].map((note) => note.id)
		}, "capital-gains")
		const guide = buildPropertyCapitalGainsGuide("en")
		expect([...guide.notes, ...guide.assumptions].map((note) => note.id)).toEqual(
			Object.values(PROPERTY_CAPITAL_GAINS_GUIDE_IDS),
		)
	})

	it.each(SUPPORTED_LANGS)("takes the example's figures from the calculator in %s", (lang) => {
		const guide = buildPropertyCapitalGainsGuide(lang)
		const money = (value: number) => formatMoney(lang, value, { decimals: 0 })

		expect(guide.gain.map((figure) => figure.value)).toEqual(
			[CAPITAL_GAINS_EXAMPLE.saleValue, result.adjustedPurchase, result.expenses, result.gain].map(money),
		)
		expect(guide.tax.map((figure) => figure.value)).toEqual([result.includedIncome, result.extraTax].map(money))
	})

	it("works out the gain the way the figures say", () => {
		const cents = (value: number) => Math.round(value * 100)
		expect(cents(CAPITAL_GAINS_EXAMPLE.saleValue - result.adjustedPurchase - result.expenses)).toBe(cents(result.gain))
		expect(cents(CAPITAL_GAINS_EXAMPLE.purchaseValue * result.coefficient)).toBe(cents(result.adjustedPurchase))
	})
})
