import { describe, expect, it } from "vitest"
import { ALLOWANCE_EXAMPLE, HOLIDAY_HIRING_YEAR_EXAMPLE, computeAllowance } from "@/lib/calculators/allowance"
import { NET_SALARY_EXAMPLE, computeNetSalary } from "@/lib/calculators/payroll"
import { formatMoney } from "@/lib/numberFormat"
import { SUPPORTED_LANGS } from "@/lib/routes"
import { WITHHOLDING_TABLES_GUIDE_IDS, buildAllowanceGuide, buildNetSalaryGuide, buildWithholdingTablesGuide } from "./salaryGuides"
import { expectFigures, expectFormulaLinks, expectStableIds, expectTerms } from "./guideTestUtils"

const euros = (lang: (typeof SUPPORTED_LANGS)[number], cents: number) => formatMoney(lang, cents / 100, { decimals: 2 })

describe("net salary guide content", () => {
	const example = computeNetSalary(NET_SALARY_EXAMPLE)
	if (!example.ok) throw new Error("The net salary example must be valid")
	const { monthly } = example.result

	it.each(SUPPORTED_LANGS)("takes the example's figures from the calculator in %s", (lang) => {
		const guide = buildNetSalaryGuide(lang)

		expectFigures(guide.flow)
		expectTerms(guide.notes)
		expect(guide.flow.map((figure) => figure.value)).toEqual([
			formatMoney(lang, NET_SALARY_EXAMPLE.grossMonthly, { decimals: 0 }),
			euros(lang, monthly.withholdingCents),
			euros(lang, monthly.socialSecurityCents),
			euros(lang, monthly.netCents),
		])
		expect(guide.flow[3].detail).toContain(euros(lang, monthly.mealAllowanceCents))
		expect(guide.flowOperators).toHaveLength(guide.flow.length - 1)
	})

	it("adds up: gross − withholding − Social Security + meal allowance = net", () => {
		expect(NET_SALARY_EXAMPLE.grossMonthly * 100 - monthly.withholdingCents - monthly.socialSecurityCents + monthly.mealAllowanceCents).toBe(
			monthly.netCents,
		)
	})
})

describe("allowance guides content", () => {
	it.each(SUPPORTED_LANGS)("takes both examples' figures from the calculator in %s", (lang) => {
		for (const [kind, input] of [["christmas", ALLOWANCE_EXAMPLE], ["holiday", HOLIDAY_HIRING_YEAR_EXAMPLE]] as const) {
			const example = computeAllowance(input)
			if (!example.ok) throw new Error("The allowance example must be valid")
			const { total } = example.result
			const guide = buildAllowanceGuide(lang, kind)

			expectFigures(guide.flow)
			expectTerms(guide.notes)
			expect(guide.flow.map((figure) => figure.value)).toEqual(
				[total.grossCents, total.withholdingCents, total.socialSecurityCents, total.netCents].map((cents) => euros(lang, cents)),
			)
			expect(total.grossCents - total.withholdingCents - total.socialSecurityCents).toBe(total.netCents)
		}
	})
})

describe("withholding tables guide content", () => {
	it.each(SUPPORTED_LANGS)("links the formula to its notes in %s", (lang) => {
		const guide = buildWithholdingTablesGuide(lang)

		expectTerms(guide.notes)
		const hrefs = expectFormulaLinks(guide.formulas, guide.notes)
		expect(hrefs).toContain(`#${WITHHOLDING_TABLES_GUIDE_IDS.transition}`)
	})

	it("keeps the same note ids in every locale", () => {
		expectStableIds((lang) => buildWithholdingTablesGuide(lang).notes, "withholding-tables")
	})
})
