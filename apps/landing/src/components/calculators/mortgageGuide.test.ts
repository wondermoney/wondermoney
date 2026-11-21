import { describe, expect, it } from "vitest"
import { MORTGAGE_EXAMPLE, computeMortgage } from "@/lib/calculators/mortgage"
import { formatMoney } from "@/lib/numberFormat"
import { SUPPORTED_LANGS } from "@/lib/routes"
import { formulaHrefs } from "./guideBlocks"
import { MORTGAGE_GUIDE_IDS, buildMortgageGuide } from "./mortgageGuide"

const calculation = computeMortgage(MORTGAGE_EXAMPLE)
if (!calculation.ok) throw new Error("invalid example")
const result = calculation.result

describe("mortgage guide content", () => {
	it.each(SUPPORTED_LANGS)("builds every note, figure and formula in %s", (lang) => {
		const guide = buildMortgageGuide(lang)

		for (const note of guide.notes) {
			expect(note.term.trim()).not.toBe("")
			expect(note.body.trim()).not.toBe("")
			expect(note.body).not.toMatch(/\{\{/)
		}
		for (const figure of [...guide.totals, ...guide.firstPayment]) expect(figure.label.trim()).not.toBe("")
		expect(guide.formulas).toHaveLength(4)
	})

	it.each(SUPPORTED_LANGS)("links every formula variable to a note in %s", (lang) => {
		const guide = buildMortgageGuide(lang)
		const ids = new Set(guide.notes.map((note) => note.id))
		const hrefs = formulaHrefs(guide.formulas)

		expect(hrefs.length).toBeGreaterThanOrEqual(10)
		for (const href of hrefs) expect(ids.has(href.slice(1))).toBe(true)
	})

	it("keeps the same note ids in every locale", () => {
		const reference = buildMortgageGuide("en").notes.map((note) => note.id)
		expect(new Set(reference).size).toBe(reference.length)
		expect(reference).toEqual(expect.arrayContaining(Object.values(MORTGAGE_GUIDE_IDS)))
		for (const lang of SUPPORTED_LANGS) expect(buildMortgageGuide(lang).notes.map((note) => note.id)).toEqual(reference)
	})

	it.each(SUPPORTED_LANGS)("takes the example's figures from the calculator in %s", (lang) => {
		const guide = buildMortgageGuide(lang)
		const money = (value: number) => formatMoney(lang, value, { decimals: 2 })
		const [first] = result.years[0].months

		expect(guide.totals.map((figure) => figure.value)).toEqual([
			money(MORTGAGE_EXAMPLE.loanAmount),
			money(result.totalInterest),
			money(result.totalPaid),
		])
		expect(guide.firstPayment.map((figure) => figure.value)).toEqual([
			money(result.monthlyPayment),
			money(first.interest),
			money(first.principal),
		])
		// Interest and principal split the first payment.
		const [, interest, principal] = guide.firstPayment
		expect(Math.round(((interest.share ?? 0) + (principal.share ?? 0)) * 10) / 10).toBe(100)
	})

	it("adds the amount borrowed and the interest up to the total paid", () => {
		expect(Math.round((MORTGAGE_EXAMPLE.loanAmount + result.totalInterest) * 100)).toBe(Math.round(result.totalPaid * 100))
	})
})
