import { describe, expect, it } from "vitest"
import { PERSONAL_LOAN_EXAMPLE, computePersonalLoan } from "@/lib/calculators/personalLoan"
import { formatMoney } from "@/lib/numberFormat"
import { SUPPORTED_LANGS } from "@/lib/routes"
import { formulaHrefs } from "./guideBlocks"
import { expectFigures, expectFormulaLinks, expectStableIds, expectTerms } from "./guideTestUtils"
import { PERSONAL_LOAN_GUIDE_IDS, buildPersonalLoanGuide } from "./personalLoanGuide"

const run = (upfrontFees: number, monthlyFees: number) => {
	const calculation = computePersonalLoan({ ...PERSONAL_LOAN_EXAMPLE, upfrontFees, monthlyFees })
	if (!calculation.ok) throw new Error("invalid example")
	return calculation.result
}
const example = run(PERSONAL_LOAN_EXAMPLE.upfrontFees, PERSONAL_LOAN_EXAMPLE.monthlyFees)
const withFees = run(PERSONAL_LOAN_EXAMPLE.exampleUpfrontFees, PERSONAL_LOAN_EXAMPLE.exampleMonthlyFees)

describe("personal loan guide content", () => {
	it.each(SUPPORTED_LANGS)("builds every term, figure and formula in %s", (lang) => {
		const guide = buildPersonalLoanGuide(lang)
		expectTerms([...guide.notes, ...guide.assumptions])
		expectFigures([...guide.noFees, ...guide.fees, ...guide.rates])
		expectFormulaLinks(guide.formulas, [...guide.notes, ...guide.assumptions])
		expect(guide.formulas).toHaveLength(4)
		expect(formulaHrefs(guide.formulas).length).toBeGreaterThanOrEqual(15)
		// The APR note reads the formula in words, not the old letters.
		expect(guide.notes[0].body).not.toMatch(/\b[PFf]\b|Mₖ|\(1 \+ A\)/)
	})

	it("keeps the same note ids in every locale", () => {
		expectStableIds((lang) => {
			const guide = buildPersonalLoanGuide(lang)
			return [...guide.notes, ...guide.assumptions]
		}, "personal-loan")
		const guide = buildPersonalLoanGuide("en")
		expect([...guide.notes, ...guide.assumptions].map((note) => note.id)).toEqual(Object.values(PERSONAL_LOAN_GUIDE_IDS))
	})

	it.each(SUPPORTED_LANGS)("takes the example's figures from the calculator in %s", (lang) => {
		const guide = buildPersonalLoanGuide(lang)
		const money = (value: number) => formatMoney(lang, value, { decimals: 2 })

		expect(guide.noFees.map((figure) => figure.value)).toEqual(
			[PERSONAL_LOAN_EXAMPLE.amount, example.totalInterest, example.totalRepaid].map(money),
		)
		expect(guide.fees.map((figure) => figure.value)).toEqual(
			[withFees.amountReceived, withFees.monthlyPayment, withFees.totalCostOfCredit].map(money),
		)
	})

	it("adds up the way the figures say", () => {
		const cents = (value: number) => Math.round(value * 100)
		expect(cents(PERSONAL_LOAN_EXAMPLE.amount + example.totalInterest)).toBe(cents(example.totalRepaid))
		expect(withFees.apr).toBeGreaterThan(example.apr)
	})
})
