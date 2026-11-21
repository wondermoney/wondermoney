import { describe, expect, it } from "vitest"
import { PROPERTY_TAX_EXAMPLE, computePropertyTax } from "@/lib/calculators/propertyTax"
import { formatMoney } from "@/lib/numberFormat"
import { SUPPORTED_LANGS } from "@/lib/routes"
import { formulaHrefs } from "./guideBlocks"
import { expectFigures, expectFormulaLinks, expectStableIds, expectTerms } from "./guideTestUtils"
import { PROPERTY_TAX_GUIDE_IDS, buildPropertyTaxGuide } from "./propertyTaxGuide"

const calculation = computePropertyTax(PROPERTY_TAX_EXAMPLE)
if (!calculation.ok) throw new Error("invalid example")
const result = calculation.result

describe("IMI guide content", () => {
	it.each(SUPPORTED_LANGS)("builds every term, figure and formula in %s", (lang) => {
		const guide = buildPropertyTaxGuide(lang)
		expectTerms([...guide.notes, ...guide.assumptions])
		expectFigures([...guide.tax, ...guide.instalments])
		expectFormulaLinks(guide.formulas, [...guide.notes, ...guide.assumptions])
		expect(formulaHrefs(guide.formulas)).toHaveLength(6)
	})

	it("keeps the same note ids in every locale", () => {
		expectStableIds((lang) => {
			const guide = buildPropertyTaxGuide(lang)
			return [...guide.notes, ...guide.assumptions]
		}, "property-tax")
		const guide = buildPropertyTaxGuide("en")
		expect([...guide.notes, ...guide.assumptions].map((note) => note.id)).toEqual(Object.values(PROPERTY_TAX_GUIDE_IDS))
	})

	it.each(SUPPORTED_LANGS)("takes the example's figures from the calculator in %s", (lang) => {
		const guide = buildPropertyTaxGuide(lang)
		const money = (value: number) => formatMoney(lang, value, { decimals: 2 })

		expect(guide.tax[0].value).toBe(money(PROPERTY_TAX_EXAMPLE.vpt))
		expect(guide.tax[2].value).toBe(money(result.annualTax))
		expect(guide.instalments.map((figure) => figure.value)).toEqual(result.schedule.map((entry) => money(entry.amount)))
	})

	it("splits the year's IMI into its instalments", () => {
		const cents = (value: number) => Math.round(value * 100)
		expect(result.schedule).toHaveLength(3)
		expect(result.schedule.reduce((total, entry) => total + cents(entry.amount), 0)).toBe(cents(result.annualTax))
	})
})
