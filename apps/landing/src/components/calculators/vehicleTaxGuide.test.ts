import { describe, expect, it } from "vitest"
import { VEHICLE_TAX_EXAMPLE, computeVehicleTax } from "@/lib/calculators/vehicleTax"
import { formatMoney } from "@/lib/numberFormat"
import { SUPPORTED_LANGS } from "@/lib/routes"
import { formulaHrefs } from "./guideBlocks"
import { expectGuideParts, expectStableIds } from "./guideTestKit"
import { VEHICLE_TAX_GUIDE_IDS, buildVehicleTaxGuide } from "./vehicleTaxGuide"

const calculation = computeVehicleTax(VEHICLE_TAX_EXAMPLE)
if (!calculation.ok) throw new Error("invalid example")
const result = calculation.result

describe("IUC guide content", () => {
	it.each(SUPPORTED_LANGS)("builds every term, figure and formula in %s", (lang) => {
		const guide = buildVehicleTaxGuide(lang)
		expectGuideParts({
			terms: [...guide.notes, ...guide.scope, ...guide.assumptions],
			figures: guide.tax,
			formulas: guide.formulas,
		})
		expect(formulaHrefs(guide.formulas)).toHaveLength(8)
	})

	it("keeps the same note ids in every locale", () => {
		expectStableIds((lang) => {
			const guide = buildVehicleTaxGuide(lang)
			return [...guide.notes, ...guide.assumptions].map((note) => note.id)
		}, "vehicle-tax")
		const guide = buildVehicleTaxGuide("en")
		expect([...guide.notes, ...guide.assumptions].map((note) => note.id)).toEqual(Object.values(VEHICLE_TAX_GUIDE_IDS))
	})

	it.each(SUPPORTED_LANGS)("takes the example's figures from the calculator in %s", (lang) => {
		const guide = buildVehicleTaxGuide(lang)
		const money = (value: number) => formatMoney(lang, value, { decimals: 2 })

		expect(guide.tax[0].value).toBe(money(result.baseTax))
		expect(guide.tax[2].value).toBe(money(result.dieselSurcharge))
		expect(guide.tax[3].value).toBe(money(result.annualTax))
	})

	it("works out the example the way the figures say", () => {
		const cents = (value: number) => Math.round(value * 100)
		expect(Math.round(cents(result.baseTax) * result.coefficient) + cents(result.dieselSurcharge)).toBe(
			cents(result.annualTax),
		)
	})
})
