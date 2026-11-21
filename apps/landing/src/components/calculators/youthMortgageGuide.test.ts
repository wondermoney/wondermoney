import { describe, expect, it } from "vitest"
import { YOUTH_MORTGAGE_EXAMPLE, computeYouthMortgage } from "@/lib/calculators/youthMortgage"
import { formatMoney } from "@/lib/numberFormat"
import { SUPPORTED_LANGS } from "@/lib/routes"
import { formulaHrefs } from "./guideBlocks"
import { expectGuideParts, expectStableIds } from "./guideTestKit"
import { YOUTH_MORTGAGE_GUIDE_IDS, buildYouthMortgageGuide } from "./youthMortgageGuide"

const calculation = computeYouthMortgage(YOUTH_MORTGAGE_EXAMPLE)
if (!calculation.ok) throw new Error("invalid example")
const result = calculation.result

describe("youth mortgage guide content", () => {
	it.each(SUPPORTED_LANGS)("builds every term, figure and formula in %s", (lang) => {
		const guide = buildYouthMortgageGuide(lang)
		expectGuideParts({
			terms: [...guide.notes, ...guide.conditions, ...guide.assumptions],
			figures: [...guide.loan, ...guide.taxes],
			formulas: guide.formulas,
		})
		expect(guide.conditions).toHaveLength(6)
		expect(formulaHrefs(guide.formulas).length).toBeGreaterThanOrEqual(15)
	})

	it("keeps the same note ids in every locale", () => {
		expectStableIds((lang) => {
			const guide = buildYouthMortgageGuide(lang)
			return [...guide.notes, ...guide.assumptions].map((note) => note.id)
		}, "youth-mortgage")
		const guide = buildYouthMortgageGuide("en")
		expect([...guide.notes, ...guide.assumptions].map((note) => note.id)).toEqual(Object.values(YOUTH_MORTGAGE_GUIDE_IDS))
	})

	it.each(SUPPORTED_LANGS)("takes the example's figures from the calculator in %s", (lang) => {
		const guide = buildYouthMortgageGuide(lang)
		const money = (value: number) => formatMoney(lang, value, { decimals: 2 })

		expect(guide.loan.map((figure) => figure.value)).toEqual([result.loan, result.monthlyPayment].map(money))
		expect(guide.taxes.map((figure) => figure.value)).toEqual(
			[result.taxesWithout, result.taxesWithYoung, result.cashWithYoung].map(money),
		)
	})

	it("needs as cash at signing only the deposit and the taxes", () => {
		const cents = (value: number) => Math.round(value * 100)
		expect(cents(YOUTH_MORTGAGE_EXAMPLE.deposit + result.taxesWithYoung)).toBe(cents(result.cashWithYoung))
	})
})
