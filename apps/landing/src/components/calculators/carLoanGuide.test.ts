import { describe, expect, it } from "vitest"
import { CAR_LOAN_EXAMPLE, computeCarLoan } from "@/lib/calculators/carLoan"
import { formatMoney } from "@/lib/numberFormat"
import { SUPPORTED_LANGS } from "@/lib/routes"
import { CAR_LOAN_GUIDE_IDS, buildCarLoanGuide } from "./carLoanGuide"
import { formulaHrefs } from "./guideBlocks"
import { expectGuideParts, expectStableIds } from "./guideTestKit"

const calculation = computeCarLoan(CAR_LOAN_EXAMPLE)
if (!calculation.ok) throw new Error("invalid example")
const result = calculation.result

describe("car loan guide content", () => {
	it.each(SUPPORTED_LANGS)("builds every term, figure and formula in %s", (lang) => {
		const guide = buildCarLoanGuide(lang)
		expectGuideParts({
			terms: [...guide.notes, ...guide.assumptions],
			figures: [...guide.financing, ...guide.budget],
			formulas: guide.formulas,
		})
		expect(formulaHrefs(guide.formulas).length).toBeGreaterThanOrEqual(15)
	})

	it("keeps the same note ids in every locale", () => {
		expectStableIds((lang) => {
			const guide = buildCarLoanGuide(lang)
			return [...guide.notes, ...guide.assumptions].map((note) => note.id)
		}, "car-loan")
		const guide = buildCarLoanGuide("en")
		expect([...guide.notes, ...guide.assumptions].map((note) => note.id)).toEqual(Object.values(CAR_LOAN_GUIDE_IDS))
	})

	it.each(SUPPORTED_LANGS)("takes the example's figures from the calculator in %s", (lang) => {
		const guide = buildCarLoanGuide(lang)
		const money = (value: number) => formatMoney(lang, value, { decimals: 2 })

		expect(guide.financing.map((figure) => figure.value)).toEqual(
			[CAR_LOAN_EXAMPLE.price, CAR_LOAN_EXAMPLE.deposit, result.financedAmount].map(money),
		)
		expect(guide.budget.map((figure) => figure.value)).toEqual(
			[result.monthlyPayment, result.monthlyRunning, result.monthlyBudget].map(money),
		)
	})

	it("adds up the way the figures say", () => {
		const cents = (value: number) => Math.round(value * 100)
		expect(cents(CAR_LOAN_EXAMPLE.price - CAR_LOAN_EXAMPLE.deposit)).toBe(cents(result.financedAmount))
		expect(cents(result.monthlyPayment + result.monthlyRunning)).toBe(cents(result.monthlyBudget))
	})
})
