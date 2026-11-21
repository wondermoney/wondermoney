import { describe, expect, it } from "vitest"
import { HOUSEHOLD_BUDGET_WORKED_EXAMPLE, computeHouseholdBudget } from "@/lib/calculators/householdBudget"
import { formatMoney, formatPercent } from "@/lib/numberFormat"
import { SUPPORTED_LANGS } from "@/lib/routes"
import { formulaHrefs } from "./guideBlocks"
import { HOUSEHOLD_BUDGET_GUIDE_IDS, buildHouseholdBudgetGuide } from "./householdBudgetGuide"

const result = computeHouseholdBudget(HOUSEHOLD_BUDGET_WORKED_EXAMPLE)

describe("household budget guide content", () => {
	it.each(SUPPORTED_LANGS)("builds every term, figure and formula in %s", (lang) => {
		const guide = buildHouseholdBudgetGuide(lang)

		for (const entry of [...guide.readTerms, ...guide.notes]) {
			expect(entry.term.trim()).not.toBe("")
			expect(entry.body.trim()).not.toBe("")
			// The term is its own key now, not the start of the body.
			expect(entry.body.startsWith(`${entry.term}:`)).toBe(false)
		}
		expect(guide.formulas).toHaveLength(3)
		expect(guide.flowOperators).toHaveLength(guide.flow.length - 1)
	})

	it.each(SUPPORTED_LANGS)("links every formula variable to a note on the page in %s", (lang) => {
		const guide = buildHouseholdBudgetGuide(lang)
		const ids = new Set([...guide.readTerms, ...guide.notes].map((entry) => entry.id))
		const hrefs = formulaHrefs(guide.formulas)

		// Each formula: its result and every variable link somewhere.
		expect(hrefs.length).toBe(9)
		for (const href of hrefs) {
			expect(href.startsWith("#")).toBe(true)
			expect(ids.has(href.slice(1))).toBe(true)
		}
		expect(hrefs).toContain(`#${HOUSEHOLD_BUDGET_GUIDE_IDS.income}`)
		expect(hrefs).toContain(`#${HOUSEHOLD_BUDGET_GUIDE_IDS.expenses}`)
		expect(hrefs).toContain(`#${HOUSEHOLD_BUDGET_GUIDE_IDS.shareNote}`)
	})

	it("keeps the same note ids in every locale", () => {
		const idsOf = (lang: (typeof SUPPORTED_LANGS)[number]) => {
			const guide = buildHouseholdBudgetGuide(lang)
			return [...guide.readTerms, ...guide.notes].map((entry) => entry.id)
		}
		const reference = idsOf("en")

		expect(new Set(reference).size).toBe(reference.length)
		for (const id of reference) expect(id).toMatch(/^household-budget-[a-z-]+$/)
		for (const lang of SUPPORTED_LANGS) expect(idsOf(lang)).toEqual(reference)
	})

	it.each(SUPPORTED_LANGS)("takes the example's figures from the calculator in %s", (lang) => {
		const guide = buildHouseholdBudgetGuide(lang)
		const money = (value: number) => formatMoney(lang, value)

		expect(guide.flow.map((figure) => figure.value)).toEqual([
			money(result.totalIncome),
			money(result.totalExpenses),
			money(result.balance),
			formatPercent(lang, result.savingsRate as number),
		])

		const categories = result.categories.filter((entry) => entry.total > 0)
		expect(guide.shares).toHaveLength(categories.length + 1)
		const byValue = [...categories].sort((a, b) => b.total - a.total)
		byValue.forEach((entry, index) => {
			expect(guide.shares[index].value).toBe(money(entry.total))
			expect(guide.shares[index].share).toBe(entry.shareOfIncome)
		})
		// The categories and the surplus split the whole income.
		const total = guide.shares.reduce((sum, figure) => sum + (figure.share ?? 0), 0)
		expect(Math.round(total * 10) / 10).toBe(100)
	})

	it("quotes the worked example the issue describes", () => {
		const guide = buildHouseholdBudgetGuide("pt")

		expect(guide.exampleValues.income).toBe(formatMoney("pt", 2850))
		expect(guide.exampleValues.expenses).toBe(formatMoney("pt", 2210))
		expect(guide.exampleValues.surplus).toBe(formatMoney("pt", 640))
		expect(guide.exampleValues.savingsRate).toBe(formatPercent("pt", 22.5))
		expect(guide.exampleValues.housingShare).toBe(formatPercent("pt", 29.8))
	})
})
